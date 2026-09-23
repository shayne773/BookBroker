import { expect } from "chai";
import { api, authHeader, createUser, offerBook, outbox, signUp } from "./helpers.js";
import { Block, OfferedBook, User, WishlistBook } from "../Data.js";
import { mail } from "../lib/mail.js";
import { notificationsSettled, unsubscribeToken } from "../lib/notifications.js";

// The notification emails sent to `user` so far, once every background send
// has finished. Account emails (confirmation and the like) are left out.
async function notificationsTo(user) {
  await notificationsSettled();
  return outbox.filter((m) => m.to === user.email && m.text.includes("/unsubscribe?token="));
}

const unsubscribeLinkIn = (email) => email.text.match(/(http\S+\/unsubscribe\?token=\S+)/)[1];
const tokenIn = (email) => new URL(unsubscribeLinkIn(email)).searchParams.get("token");

describe("notification emails", () => {
  let alice;
  let bob;

  beforeEach(async () => {
    alice = await signUp();
    bob = await signUp();
  });

  const say = (from, to, content = "Hello") =>
    api(from.token).post(`/messages/${to.id}`).send({ content });

  describe("messages", () => {
    it("emails the recipient a link to the conversation, and never the sender", async () => {
      const res = await say(alice, bob);
      expect(res).to.have.status(200);

      const [email, ...rest] = await notificationsTo(bob);
      expect(rest).to.have.length(0);
      expect(email.subject).to.equal(`New message from ${alice.username}`);
      expect(email.link).to.equal(`http://localhost:3000/messages/${alice.id}`);
      expect(email.text).to.include(`${alice.username} sent you a message.`);
      expect(email.text).to.include("http://localhost:3000/profile#notifications");
      expect(email.html).to.include(email.link);
      expect(await notificationsTo(alice)).to.have.length(0);
    });

    it("sends one email per conversation until the recipient reads it", async () => {
      await say(alice, bob, "one");
      await notificationsSettled();
      await say(alice, bob, "two");
      await say(alice, bob, "three");
      expect(await notificationsTo(bob)).to.have.length(1);

      const read = await api(bob.token).post(`/messages/${alice.id}/read`).send({});
      expect(read).to.have.status(204);

      await say(alice, bob, "four");
      expect(await notificationsTo(bob)).to.have.length(2);
    });

    it("keeps each conversation's allowance separate", async () => {
      const carol = await signUp();
      await say(alice, bob);
      await say(carol, bob);

      expect((await notificationsTo(bob)).map((m) => m.link).sort()).to.deep.equal(
        [`http://localhost:3000/messages/${alice.id}`, `http://localhost:3000/messages/${carol.id}`].sort()
      );
    });

    it("sends nothing for a message to oneself", async () => {
      await say(alice, alice);
      expect(await notificationsTo(alice)).to.have.length(0);
    });

    it("sends nothing to a reader who turned message emails off", async () => {
      await api(bob.token).post("/user/notifications").send({ messages: false });
      await say(alice, bob);
      expect(await notificationsTo(bob)).to.have.length(0);
    });

    it("sends nothing to an account whose email is not confirmed", async () => {
      const unconfirmed = await createUser({ emailVerified: false });
      await api(alice.token).post(`/messages/${unconfirmed._id}`).send({ content: "Hi" });
      expect(await notificationsTo(unconfirmed)).to.have.length(0);
    });

    it("still delivers the message when the email cannot be sent", async () => {
      const deliver = mail.deliver;
      const errors = [];
      const consoleError = console.error;
      mail.deliver = async () => {
        throw new Error("Resend is down");
      };
      console.error = (...args) => errors.push(args);
      try {
        const res = await say(alice, bob);
        await notificationsSettled();
        expect(res).to.have.status(200);
        expect(errors).to.have.length(1);
        expect(String(errors[0][1])).to.include("Resend is down");
      } finally {
        mail.deliver = deliver;
        console.error = consoleError;
      }

      const thread = await api(bob.token).get(`/messages/${alice.id}`);
      expect(thread.body.map((m) => m.content)).to.deep.equal(["Hello"]);
    });
  });

  describe("trades", () => {
    let aliceBook;
    let bobBook;

    beforeEach(async () => {
      aliceBook = await offerBook(alice, { isbn: "1111111111111" });
      bobBook = await offerBook(bob, { isbn: "2222222222222" });
    });

    async function propose() {
      const res = await api(alice.token)
        .post("/exchanges")
        .send({ responderId: bob.id, requesterBooks: [aliceBook.id], responderBooks: [bobBook.id] });
      expect(res).to.have.status(201);
      return res.body._id;
    }

    const subjects = async (user) => (await notificationsTo(user)).map((m) => m.subject);

    it("tells the responder about a proposal, with a link to the trade", async () => {
      const id = await propose();

      const [email] = await notificationsTo(bob);
      expect(email.subject).to.equal(`${alice.username} proposed a trade`);
      expect(email.link).to.equal(`http://localhost:3000/exchanges/${id}`);
      expect(await notificationsTo(alice)).to.have.length(0);
    });

    it("tells the other side of a counter, an acceptance and a completion", async () => {
      const id = await propose();
      await api(bob.token).post(`/exchanges/${id}/counter`).send({
        requesterBooks: [aliceBook.id],
        responderBooks: [],
      });
      await api(alice.token).post(`/exchanges/${id}/accept`);
      await api(bob.token).post(`/exchanges/${id}/confirm-complete`);
      await api(alice.token).post(`/exchanges/${id}/confirm-complete`);

      expect(await subjects(alice)).to.deep.equal([`${bob.username} countered your trade`]);
      expect(await subjects(bob)).to.deep.equal([
        `${alice.username} proposed a trade`,
        `${alice.username} accepted your trade`,
        "Your trade is complete",
      ]);
    });

    it("tells the other side of a decline and a cancellation", async () => {
      const declined = await propose();
      await api(bob.token).post(`/exchanges/${declined}/decline`);

      const cancelled = await propose();
      await api(bob.token).post(`/exchanges/${cancelled}/cancel`);

      expect(await subjects(alice)).to.deep.equal([
        `${bob.username} declined your trade`,
        `${bob.username} cancelled your trade`,
      ]);
    });

    it("sends nothing across a block", async () => {
      const id = await propose();
      await notificationsSettled();
      await Block.create({ blocker: alice.id, blocked: bob.id });

      const res = await api(bob.token).post(`/exchanges/${id}/cancel`);
      expect(res).to.have.status(200);
      expect(await notificationsTo(alice)).to.have.length(0);
    });

    it("sends nothing to a suspended reader about a trade already under way", async () => {
      const id = await propose();
      await notificationsSettled();
      await User.updateOne({ _id: alice.id }, { suspended: true });

      const res = await api(bob.token).post(`/exchanges/${id}/decline`);
      expect(res).to.have.status(200);
      expect(await notificationsTo(alice)).to.have.length(0);
    });

    it("sends nothing to a reader who turned trade emails off", async () => {
      await api(bob.token).post("/user/notifications").send({ trades: false });
      await propose();
      expect(await notificationsTo(bob)).to.have.length(0);
    });
  });

  describe("wishlist matches", () => {
    const ISBN = "9780261102217";
    const wish = (user, fields = {}) =>
      WishlistBook.create({ userId: user.id, title: "The Hobbit", author: "Tolkien", isbn: ISBN, ...fields });

    const offer = (user, fields = {}) =>
      api(user.token)
        .post("/user/add-offered-book")
        .send({ title: "The Hobbit", author: "Tolkien", isbn: ISBN, cover: "https://example.com/c.jpg", ...fields });

    it("emails each reader who wishlisted a newly offered book once, with a link to it", async () => {
      await wish(bob);
      await wish(bob, { title: "The Hobbit (again)" });

      const res = await offer(alice);
      expect(res).to.have.status(201);

      const emails = await notificationsTo(bob);
      expect(emails).to.have.length(1);
      const book = await OfferedBook.findOne({ owner: alice.id });
      expect(emails[0].link).to.equal(`http://localhost:3000/books/${book._id}`);
      expect(emails[0].text).to.include(`${alice.username} is offering The Hobbit, a book on your wishlist.`);
    });

    it("does not email the reader about their own offer", async () => {
      await wish(alice);
      await offer(alice);
      expect(await notificationsTo(alice)).to.have.length(0);
    });

    it("does not email a reader who wishlisted a different ISBN", async () => {
      await wish(bob, { isbn: "9780000000001" });
      await offer(alice);
      expect(await notificationsTo(bob)).to.have.length(0);
    });

    it("sends nothing across a block, whichever side placed it", async () => {
      const carol = await signUp();
      await wish(bob);
      await wish(carol);
      await Block.create({ blocker: bob.id, blocked: alice.id });
      await Block.create({ blocker: alice.id, blocked: carol.id });

      await offer(alice);
      expect(await notificationsTo(bob)).to.have.length(0);
      expect(await notificationsTo(carol)).to.have.length(0);
    });

    it("sends nothing to a reader who turned wishlist emails off", async () => {
      await wish(bob);
      await api(bob.token).post("/user/notifications").send({ wishlist: false });
      await offer(alice);
      expect(await notificationsTo(bob)).to.have.length(0);
    });
  });

  describe("settings", () => {
    it("has every category on by default, including for accounts that predate the setting", async () => {
      const legacy = await createUser();
      await User.collection.updateOne({ _id: legacy._id }, { $unset: { notifications: 1 } });

      const res = await api().get("/user").set(await authHeader(legacy));
      expect(res).to.have.status(200);
      expect(res.body.notifications).to.deep.equal({ messages: true, trades: true, wishlist: true });
    });

    it("turns single categories off and on", async () => {
      let res = await api(alice.token).post("/user/notifications").send({ trades: false });
      expect(res).to.have.status(200);
      expect(res.body.notifications).to.deep.equal({ messages: true, trades: false, wishlist: true });

      res = await api(alice.token).post("/user/notifications").send({ trades: true, wishlist: false });
      expect(res.body.notifications).to.deep.equal({ messages: true, trades: true, wishlist: false });

      const me = await api(alice.token).get("/user");
      expect(me.body.notifications).to.deep.equal({ messages: true, trades: true, wishlist: false });
    });

    it("refuses a value that is not a boolean, and needs a sign-in", async () => {
      const res = await api(alice.token).post("/user/notifications").send({ messages: "no" });
      expect(res).to.have.status(400);

      const anonymous = await api().post("/user/notifications").send({ messages: false });
      expect(anonymous).to.have.status(401);
    });

    it("never sends the signing key to the client", async () => {
      await say(alice, bob);
      await notificationsSettled();
      const me = await api(bob.token).get("/user");
      expect(me.body).to.not.have.property("notificationKey");
    });
  });

  describe("unsubscribe links", () => {
    const unsubscribe = (token) => api().post("/notifications/unsubscribe").send({ token });

    it("turns off the email's category without signing in", async () => {
      await say(alice, bob);
      const [email] = await notificationsTo(bob);
      expect(unsubscribeLinkIn(email)).to.match(/^http:\/\/localhost:3000\/unsubscribe\?token=/);

      const res = await unsubscribe(tokenIn(email));
      expect(res).to.have.status(200);
      expect(res.body.category).to.equal("messages");

      const me = await api(bob.token).get("/user");
      expect(me.body.notifications).to.deep.equal({ messages: false, trades: true, wishlist: true });

      await api(bob.token).post(`/messages/${alice.id}/read`).send({});
      await say(alice, bob, "again");
      expect(await notificationsTo(bob)).to.have.length(1);
    });

    it("keeps working after it has been used", async () => {
      const token = await unsubscribeToken(bob.id, "trades");
      expect(await unsubscribe(token)).to.have.status(200);
      expect(await unsubscribe(token)).to.have.status(200);
    });

    it("refuses a token turned to another category or another reader", async () => {
      const token = await unsubscribeToken(bob.id, "messages");
      await unsubscribeToken(alice.id, "messages");
      const [id, , mac] = token.split(".");

      for (const forged of [
        `${id}.trades.${mac}`,
        `${alice.id}.messages.${mac}`,
        `${id}.messages.${mac.slice(0, -2)}xx`,
        `${id}.messages`,
        "nonsense",
        "",
      ]) {
        const res = await unsubscribe(forged);
        expect(res, forged).to.have.status(400);
        expect(res.body.code).to.equal("TOKEN_INVALID");
      }

      const me = await api(bob.token).get("/user");
      expect(me.body.notifications).to.deep.equal({ messages: true, trades: true, wishlist: true });
    });
  });
});
