// jest-dom adds custom matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// The app never pops up (see Feedback.jsx), so any flow that tries fails its test.
for (const name of ['alert', 'confirm', 'prompt']) {
  window[name] = () => {
    throw new Error(`window.${name}() called: use inline feedback instead`);
  };
}
