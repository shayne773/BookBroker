import { createContext, useCallback, useContext } from 'react';
import { useSignedIn } from './auth';

// Visitors can browse without an account; everything that needs one (a
// wishlist, messages, offering or trading a book, reporting) stays in view and,
// for a visitor, opens the sign-up prompt (AccountPrompt.jsx) instead of acting.
// The context holds the function that opens it; AccountPromptProvider supplies it.
export const AccountPromptContext = createContext(null);

// A page rendered without the provider (a signed-in test) has no prompt.
const noPrompt = () => {};

// `signedIn`, and `gate(action, run)`: a handler that runs `run` for a signed-in
// reader and, for a visitor, asks them to sign up to `action` (e.g. "message
// readers") instead, stopping a link from being followed. `prompt(action)`
// opens the prompt directly.
const useAccountPrompt = () => {
  const signedIn = useSignedIn();
  const prompt = useContext(AccountPromptContext) ?? noPrompt;

  const gate = useCallback(
    (action, run) =>
      (...args) => {
        if (signedIn) return run(...args);
        args[0]?.preventDefault?.();
        prompt(action);
      },
    [signedIn, prompt]
  );

  return { signedIn, gate, prompt };
};

export default useAccountPrompt;
