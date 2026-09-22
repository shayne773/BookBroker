// The one door to external HTTP APIs (Google Books, Open Library). Tests
// replace `http.get` in test/setup.js, so no test can reach the network.
import axios from "axios";

export const http = {
  get: (url, config) => axios.get(url, config),
};

export const pause = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());
