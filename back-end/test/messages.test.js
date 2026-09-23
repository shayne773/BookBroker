import { expect } from "chai";
import mongoose from "mongoose";
import { api, signUp } from "./helpers.js";
import { Conversation, Message } from "../Data.js";

describe("messages", () => {
  let ada;
  let bea;
  let cal;

  beforeEach(async () => {
    [ada, bea, cal] = await Promise.all([signUp(), signUp(), signUp()]);
  });

  async function send(from, to, content) {
    const res = await api(from.token).post(`/messages/${to.id}`).send({ content });
    expect(res).to.have.status(200);
    return String(res.body.messageId);
  }

  const unreadCount = async (user) => {
    const res = await api(user.token).get("/messages/unread");
    expect(res).to.have.status(200);
    return res.body.conversations;
  };

  const inboxRow = async (user, other) => {
    const res = await api(user.token).get("/messages");
    expect(res).to.have.status(200);
    return res.body.find((row) => String(row.otherUser.id) === other.id);
  };

  describe("the thread and its incremental fetch", () => {
    it("returns the whole thread oldest first, and only newer messages after a cursor", async () => {
      const first = await send(ada, bea, "one");
      const second = await send(bea, ada, "two");
      const third = await send(ada, bea, "three");

      const all = await api(bea.token).get(`/messages/${ada.id}`);
      expect(all).to.have.status(200);
      expect(all.body.map((m) => m.content)).to.deep.equal(["one", "two", "three"]);
      expect(all.body[0]).to.include({ sender: ada.id, content: "one" });
      expect(String(all.body[0].id)).to.equal(first);

      const newer = await api(bea.token).get(`/messages/${ada.id}?after=${first}`);
      expect(newer.body.map((m) => String(m.id))).to.deep.equal([second, third]);

      const none = await api(bea.token).get(`/messages/${ada.id}?after=${third}`);
      expect(none.body).to.deep.equal([]);
    });

    it("returns messages that share their cursor's timestamp", async () => {
      const first = await send(ada, bea, "one");
      const tied = await Message.create({
        content: "same millisecond",
        conversation: (await Message.findById(first)).conversation,
        user: bea.id,
        createdAt: (await Message.findById(first)).createdAt,
      });

      const res = await api(ada.token).get(`/messages/${bea.id}?after=${first}`);
      expect(res.body.map((m) => String(m.id))).to.deep.equal([String(tied._id)]);
    });

    it("answers an empty thread with someone the caller has not written to yet", async () => {
      const res = await api(ada.token).get(`/messages/${bea.id}`);
      expect(res).to.have.status(200);
      expect(res.body).to.deep.equal([]);
    });

    it("rejects a cursor that is malformed or from another conversation", async () => {
      await send(ada, bea, "hello");
      const elsewhere = await send(ada, cal, "hi cal");

      const malformed = await api(ada.token).get(`/messages/${bea.id}?after=nope`);
      expect(malformed).to.have.status(400);

      const foreign = await api(ada.token).get(`/messages/${bea.id}?after=${elsewhere}`);
      expect(foreign).to.have.status(400);
    });

    it("keeps a conversation with oneself apart from the caller's other conversations", async () => {
      const toBea = await send(ada, bea, "for bea");
      const note = await send(ada, ada, "note to self");

      const self = await api(ada.token).get(`/messages/${ada.id}`);
      expect(self).to.have.status(200);
      expect(self.body.map((m) => String(m.id))).to.deep.equal([note]);

      const withBea = await api(ada.token).get(`/messages/${bea.id}`);
      expect(withBea.body.map((m) => String(m.id))).to.deep.equal([toBea]);

      const crossed = await api(ada.token).get(`/messages/${ada.id}?after=${toBea}`);
      expect(crossed).to.have.status(400);
      expect(await unreadCount(ada)).to.equal(0);
    });

    it("sends a long message, and to an id with no account behind it", async () => {
      const long = "x".repeat(5000);
      await send(ada, bea, long);
      const thread = await api(bea.token).get(`/messages/${ada.id}`);
      expect(thread.body[0].content).to.equal(long);

      const nobody = { id: String(new mongoose.Types.ObjectId()) };
      await send(ada, nobody, "anyone there?");
    });

    it("needs a signed-in user", async () => {
      expect(await api().get("/messages/unread")).to.have.status(401);
      expect(await api().get(`/messages/${ada.id}`)).to.have.status(401);
      expect(await api().post(`/messages/${ada.id}/read`)).to.have.status(401);
    });
  });

  describe("unread state", () => {
    it("counts a conversation unread for the recipient only, until they mark it read", async () => {
      await send(bea, ada, "are you there?");
      await send(bea, ada, "hello?");

      expect(await unreadCount(ada)).to.equal(1);
      expect((await inboxRow(ada, bea)).unread).to.equal(2);
      expect(await unreadCount(bea)).to.equal(0);
      expect((await inboxRow(bea, ada)).unread).to.equal(0);

      const read = await api(ada.token).post(`/messages/${bea.id}/read`).send({});
      expect(read).to.have.status(204);

      expect(await unreadCount(ada)).to.equal(0);
      expect((await inboxRow(ada, bea)).unread).to.equal(0);

      await send(bea, ada, "one more");
      expect(await unreadCount(ada)).to.equal(1);
      expect((await inboxRow(ada, bea)).unread).to.equal(1);
    });

    it("clears when the recipient replies", async () => {
      await send(bea, ada, "hi");
      await send(ada, bea, "hi back");

      expect(await unreadCount(ada)).to.equal(0);
      expect(await unreadCount(bea)).to.equal(1);
    });

    it("marks read up to the message the client has shown, and never moves back", async () => {
      const first = await send(bea, ada, "one");
      const second = await send(bea, ada, "two");
      await send(bea, ada, "three");

      await api(ada.token).post(`/messages/${bea.id}/read`).send({ upTo: second });
      expect((await inboxRow(ada, bea)).unread).to.equal(1);
      expect(await unreadCount(ada)).to.equal(1);

      await api(ada.token).post(`/messages/${bea.id}/read`).send({ upTo: first });
      expect((await inboxRow(ada, bea)).unread).to.equal(1);
    });

    it("counts each unread conversation once", async () => {
      await send(bea, ada, "from bea");
      await send(cal, ada, "from cal");
      await send(cal, ada, "cal again");

      expect(await unreadCount(ada)).to.equal(2);
    });

    it("counts conversations saved before unread tracking existed", async () => {
      const convo = await Conversation.collection.insertOne({ users: [ada.id, bea.id].map(toId) });
      await Message.create({ conversation: convo.insertedId, user: bea.id, content: "old" });

      expect(await unreadCount(ada)).to.equal(1);
      expect((await inboxRow(ada, bea)).unread).to.equal(1);
    });
  });

  describe("other people's conversations", () => {
    it("cannot be read, listed, counted or marked read by someone outside them", async () => {
      const secret = await send(ada, bea, "just between us");

      const thread = await api(cal.token).get(`/messages/${ada.id}`);
      expect(thread).to.have.status(200);
      expect(thread.body).to.deep.equal([]);

      const withCursor = await api(cal.token).get(`/messages/${ada.id}?after=${secret}`);
      expect(withCursor.body).to.deep.equal([]);

      const inbox = await api(cal.token).get("/messages");
      expect(inbox.body).to.deep.equal([]);
      expect(await unreadCount(cal)).to.equal(0);

      const mark = await api(cal.token).post(`/messages/${bea.id}/read`).send({ upTo: secret });
      expect(mark).to.have.status(404);

      // Nor through a conversation cal does have with bea.
      await send(cal, bea, "hi bea");
      const crossed = await api(cal.token).post(`/messages/${bea.id}/read`).send({ upTo: secret });
      expect(crossed).to.have.status(400);
      const crossedFetch = await api(cal.token).get(`/messages/${bea.id}?after=${secret}`);
      expect(crossedFetch).to.have.status(400);

      expect(await unreadCount(bea)).to.equal(2);
    });
  });
});

const toId = (id) => new mongoose.Types.ObjectId(id);
