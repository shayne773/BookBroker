import { vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AdminReports from './AdminReports';

const rob = { _id: 'rob', username: 'rob', suspended: false };
const ann = { _id: 'ann', username: 'ann' };

let reports;
let forbidden;
let calls;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('token', 'token');
  localStorage.setItem('userId', 'admin');
  forbidden = false;
  calls = [];
  reports = [
    {
      _id: 'r1',
      reporter: ann,
      reported: rob,
      reason: 'SCAM',
      details: 'Asked for money up front.',
      createdAt: '2026-09-20T10:00:00Z',
      reviewedAt: null,
    },
  ];

  global.fetch = vi.fn(async (url, options = {}) => {
    // The API base is unset under test, so the URL is "undefined/<path>".
    const [path, query = ''] = String(url).replace(/^[^/]*/, '').split('?');
    const method = options.method || 'GET';
    calls.push({ method, path, query, body: options.body && JSON.parse(options.body) });
    const reply = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

    if (forbidden) return reply({ message: 'Admins only.' }, 403);
    if (path === '/admin/reports') {
      const reviewed = query.includes('status=reviewed');
      return reply(reports.filter((r) => Boolean(r.reviewedAt) === reviewed));
    }
    if (path === '/admin/reports/r1/review') return reply({ reviewedAt: '2026-09-21T10:00:00Z' });
    if (path === '/admin/users/rob/suspend' && method === 'POST') {
      return reply({ suspended: true, suspension: { note: options.body && JSON.parse(options.body).note } });
    }
    if (path === '/admin/users/rob/suspend') return reply({ suspended: false });
    return reply({}, 404);
  });
});

afterEach(() => {
  delete global.fetch;
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/admin/reports']}>
      <Routes>
        <Route path="/admin/reports" element={<AdminReports />} />
        <Route path="/home" element={<div>Home page</div>} />
      </Routes>
    </MemoryRouter>
  );

test('lists open reports with the reader, reporter, reason, details and a link to the reader', async () => {
  renderPage();

  const link = await screen.findByRole('link', { name: 'rob' });
  expect(link).toHaveAttribute('href', '/users/rob');
  expect(screen.getByText(/Scam or fraud/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'ann' })).toBeInTheDocument();
  expect(screen.getByText('Asked for money up front.')).toBeInTheDocument();
  expect(calls[0]).toMatchObject({ path: '/admin/reports', query: 'status=open' });
});

test('switches to reviewed reports', async () => {
  reports.push({ ...reports[0], _id: 'r2', details: 'Old one', reviewedAt: '2026-09-01T10:00:00Z' });
  renderPage();
  await screen.findByText('Asked for money up front.');

  fireEvent.click(screen.getByRole('button', { name: 'Reviewed' }));

  expect(await screen.findByText('Old one')).toBeInTheDocument();
  expect(screen.queryByText('Asked for money up front.')).not.toBeInTheDocument();
});

test('marking a report reviewed takes it off the open list', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Mark reviewed' }));

  await waitFor(() => expect(screen.queryByText('Asked for money up front.')).not.toBeInTheDocument());
  expect(calls.at(-1)).toMatchObject({ method: 'POST', path: '/admin/reports/r1/review' });
  expect(screen.getByText('No open reports.')).toBeInTheDocument();
});

test('suspends the reported reader with a note, then offers to unsuspend them', async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Suspend rob' }));

  const dialog = screen.getByRole('dialog', { name: 'Suspend rob?' });
  fireEvent.change(within(dialog).getByLabelText(/Note/), { target: { value: 'Repeated scams' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Suspend' }));

  expect(await screen.findByRole('button', { name: 'Unsuspend rob' })).toBeInTheDocument();
  expect(calls.at(-1)).toMatchObject({
    method: 'POST',
    path: '/admin/users/rob/suspend',
    body: { note: 'Repeated scams' },
  });
  expect(screen.getByText('Suspended')).toBeInTheDocument();
  expect(screen.getByText('Suspension note: Repeated scams')).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Unsuspend rob' }));
  expect(await screen.findByRole('button', { name: 'Suspend rob' })).toBeInTheDocument();
  expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/admin/users/rob/suspend' });
});

test('offers no suspend button on a report about the admin themselves', async () => {
  reports[0].reported = { _id: 'admin', username: 'me', suspended: false };
  renderPage();

  await screen.findByRole('link', { name: 'me' });
  expect(screen.queryByRole('button', { name: /Suspend/ })).not.toBeInTheDocument();
});

test('sends anyone who is not an admin home', async () => {
  forbidden = true;
  renderPage();

  expect(await screen.findByText('Home page')).toBeInTheDocument();
});
