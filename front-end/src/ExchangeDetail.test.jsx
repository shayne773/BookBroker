import { vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import ExchangeDetail from './ExchangeDetail';
import ExchangesList from './ExchangesList';
import { deadlineDate } from './exchangeStatus';

const base = {
  _id: 'ex1',
  requester: { _id: 'them', username: 'rob' },
  responder: { _id: 'me', username: 'me' },
  requesterBooks: [],
  responderBooks: [],
  message: '',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

function serve(exchange) {
  global.fetch = vi.fn(async (url) => {
    const path = String(url).replace(/^[^/]*/, '');
    const body = path === '/exchanges' ? [exchange] : exchange;
    return { ok: true, status: 200, json: async () => body };
  });
}

function renderAt(path) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/exchanges" element={<ExchangesList />} />
        <Route path="/exchanges/:exchangeId" element={<ExchangeDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'me');
});

afterEach(() => {
  delete global.fetch;
});

const autoCompletesAt = '2026-09-08T12:00:00.000Z';

test('tells the reader who has not confirmed when the trade completes without them', async () => {
  serve({ ...base, status: 'ACCEPTED', requesterConfirmedComplete: true, autoCompletesAt });

  renderAt('/exchanges/ex1');

  expect(
    await screen.findByText(
      `Completes automatically on ${deadlineDate(autoCompletesAt)}. Confirm, or message them if something is wrong.`
    )
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
});

test('tells the reader who confirmed that they can still cancel before the trade completes', async () => {
  serve({ ...base, status: 'ACCEPTED', responderConfirmedComplete: true, autoCompletesAt });

  renderAt('/exchanges/ex1');

  expect(
    await screen.findByText(`Completes automatically on ${deadlineDate(autoCompletesAt)} unless you cancel.`)
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

test('says when a trade was completed automatically, after the days its deadline allowed', async () => {
  serve({ ...base, status: 'COMPLETED', requesterConfirmedComplete: true, autoCompleted: true, deadlineDays: 7 });

  renderAt('/exchanges/ex1');

  expect(await screen.findByText('Completed automatically after 7 days.')).toBeInTheDocument();
});

test('says an offer expired after the days its deadline allowed', async () => {
  serve({ ...base, status: 'EXPIRED', deadlineDays: 14 });

  renderAt('/exchanges/ex1');

  expect(await screen.findByText('Expired after 14 days without a response.')).toBeInTheDocument();
});

test('calls an offer that expired under an older rule just Expired', async () => {
  serve({ ...base, status: 'EXPIRED' });

  renderAt('/exchanges/ex1');

  expect(await screen.findByText('Expired')).toBeInTheDocument();
  expect(screen.queryByText(/without a response/)).not.toBeInTheDocument();
});

test('lists an unanswered offer past its deadline as Expired', async () => {
  serve({ ...base, status: 'EXPIRED' });

  renderAt('/exchanges');

  expect(await screen.findByText('Expired')).toBeInTheDocument();
});

test("names both sides of a trade, each linked to their profile, and your own to yours", async () => {
  serve({ ...base, status: 'ACCEPTED' });

  renderAt('/exchanges/ex1');

  const heading = await screen.findByRole('heading', { level: 1, name: 'rob' });
  expect(within(heading).getByRole('link', { name: 'rob' })).toHaveAttribute('href', '/users/them');

  // What each side gives, and who has confirmed the hand-over.
  const robLinks = screen.getAllByRole('link', { name: 'rob' });
  const myLinks = screen.getAllByRole('link', { name: 'me' });
  expect(robLinks.length).toBeGreaterThanOrEqual(3);
  expect(myLinks.length).toBeGreaterThanOrEqual(2);
  robLinks.forEach((link) => expect(link).toHaveAttribute('href', '/users/them'));
  myLinks.forEach((link) => expect(link).toHaveAttribute('href', '/profile'));
});

test("a trade's action is confirmed in place, not in a pop-up", async () => {
  serve({ ...base, status: 'PENDING', proposedBy: 'them' });

  renderAt('/exchanges/ex1');

  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));

  expect(await screen.findByText('Accepted')).toBeInTheDocument();
  expect(document.querySelector('.toast')).toBeNull();
});

test("the trade list names the other reader, linked to their profile, beside the row's own link", async () => {
  serve({ ...base, status: 'PENDING' });

  renderAt('/exchanges');

  expect(await screen.findByRole('link', { name: 'rob' })).toHaveAttribute('href', '/users/them');
  expect(screen.getByRole('link', { name: /View \/ Respond exchange with rob/ })).toHaveAttribute(
    'href',
    '/exchanges/ex1'
  );
});
