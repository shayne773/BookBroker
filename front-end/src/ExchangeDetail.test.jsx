import { vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

test('an accepted trade one side has confirmed shows both readers when it completes by itself', async () => {
  const autoCompletesAt = '2026-09-08T12:00:00.000Z';
  serve({ ...base, status: 'ACCEPTED', requesterConfirmedComplete: true, autoCompletesAt });

  renderAt('/exchanges/ex1');

  expect(
    await screen.findByText(`Completes automatically on ${deadlineDate(autoCompletesAt)} unless cancelled.`)
  ).toBeInTheDocument();
});

test('says when a trade was completed automatically', async () => {
  serve({ ...base, status: 'COMPLETED', requesterConfirmedComplete: true, autoCompleted: true });

  renderAt('/exchanges/ex1');

  expect(await screen.findByText('Completed automatically after 7 days.')).toBeInTheDocument();
});

test('lists an unanswered offer past its deadline as Expired', async () => {
  serve({ ...base, status: 'EXPIRED' });

  renderAt('/exchanges');

  expect(await screen.findByText('Expired')).toBeInTheDocument();
});
