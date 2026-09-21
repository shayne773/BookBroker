import { vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import CounterOfferDialog from './CounterOfferDialog';

const requesterBook = { _id: 'req-book', title: 'Requester book' };
const responderBook = { _id: 'res-book', title: 'Responder book' };
const requesterSpare = { _id: 'req-spare', title: 'Requester spare' };
const responderSpare = { _id: 'res-spare', title: 'Responder spare' };

const ex = {
  _id: 'ex1',
  requester: { _id: 'requester', username: 'rita' },
  responder: { _id: 'responder', username: 'rob' },
  requesterBooks: [requesterBook],
  responderBooks: [responderBook],
  message: 'Swap?',
};

// Each user's offered shelf, keyed by the user id in /users/:id/offered.
const shelves = {
  requester: [requesterBook, requesterSpare],
  responder: [responderBook, responderSpare],
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  global.fetch = vi.fn(async (url) => {
    const id = String(url).match(/\/users\/([^/]+)\/offered/)[1];
    return { ok: true, status: 200, json: async () => shelves[id] };
  });
});

afterEach(() => {
  delete global.fetch;
});

const renderAs = (me, onSubmit = vi.fn()) => {
  localStorage.setItem('userId', me);
  const meIsRequester = me === 'requester';
  render(
    <CounterOfferDialog
      ex={ex}
      meIsRequester={meIsRequester}
      otherUser={meIsRequester ? ex.responder : ex.requester}
      busy={false}
      onClose={() => {}}
      onSubmit={onSubmit}
    />
  );
  return onSubmit;
};

const pick = (name) => screen.findByRole('button', { name });

test.each(['requester', 'responder'])(
  'as the %s, each side of the trade opens with its own books preselected',
  async (me) => {
    renderAs(me);

    for (const book of [requesterBook, responderBook]) {
      expect(await pick(book.title)).toHaveAttribute('aria-pressed', 'true');
    }
    for (const book of [requesterSpare, responderSpare]) {
      expect(await pick(book.title)).toHaveAttribute('aria-pressed', 'false');
    }
  }
);

test('as the responder, my picks are sent as responderBooks', async () => {
  const onSubmit = renderAs('responder');

  fireEvent.click(await pick(responderSpare.title));
  fireEvent.click(await pick(requesterSpare.title));
  fireEvent.click(screen.getByRole('button', { name: 'Send Counter' }));

  expect(onSubmit).toHaveBeenCalledWith({
    requesterBooks: [requesterBook._id, requesterSpare._id],
    responderBooks: [responderBook._id, responderSpare._id],
    message: 'Swap?',
  });
});
