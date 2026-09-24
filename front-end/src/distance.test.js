import { formatDistance, normalizeZip } from './distance';

test('a distance reads in whole miles, and under one mile as less than 1 mi', () => {
  expect(formatDistance(3)).toBe('3 mi away');
  expect(formatDistance(1)).toBe('1 mi away');
  expect(formatDistance(0)).toBe('less than 1 mi away');
});

test('a book beyond your distance reads as the label the API sent', () => {
  expect(formatDistance(undefined, 'More than 25 mi away')).toBe('More than 25 mi away');
});

test('no distance reads as nothing', () => {
  expect(formatDistance(undefined)).toBe('');
  expect(formatDistance(null)).toBe('');
});

test('a ZIP code is five digits, optionally with its +4', () => {
  expect(normalizeZip(' 11201 ')).toBe('11201');
  expect(normalizeZip('11201-1234')).toBe('11201');
  expect(normalizeZip('1120')).toBeNull();
  expect(normalizeZip('M5V 2T6')).toBeNull();
});
