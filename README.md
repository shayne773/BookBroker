# BookBroker

Bookbroker is an app designed to facilitate trades between people who have books and people who want books, both to foster community and encourage reading in an affordable, sustainable way.

BookBroker is our final project for our Agile Software Development course at NYU.

[Contributing Guidelines](./CONTRIBUTING.md)

## Team Members
- [Isaac](https://github.com/isaac1000000)
- [Sewon](https://github.com/SewonKim0)
- [Rainn](https://github.com/Rainn-J)
- [Shayne](https://github.com/shayne773)
- [Stephen](https://github.com/StephenS2021)

## Project Setup
Create a file at front-end/.env.local and add the following line to the file:
```
VITE_SERVER_ADDRESS="http://localhost:5000"
```

Create a file at back-end/.env and add the following line to the file:
```
MONGODB_URI=mongodb+srv://rain:rain12345678@bookbroker.nelw2as.mongodb.net/?retryWrites=true&w=majority&appName=BookBroker
JWT_SECRET="MYSECRET"
```

See [back-end/.env.example](./back-end/.env.example) for the full list of back-end
environment variables, including the CORS allowlist (`CORS_ALLOWED_ORIGINS`). Every
optional variable has a working local default, so the two lines above are still enough
for development.
Without `RESEND_API_KEY` the API sends no email: sign-up confirmation, password reset
and email change links are printed to the back-end console instead, so you can follow them locally.
Book search (adding a book from Google Books) needs `GOOGLE_BOOKS_API_KEY` in `back-end/.env`;
without it the search says it is temporarily unavailable.

### Frontend
Navigate to the frontend directory and run the react app
```
cd front-end
npm install
npm run dev
```
`VITE_SERVER_ADDRESS` is compiled into the bundle at build time, so each environment
needs its own build with its own value; see `front-end/README.md`.

### Backend
Navigate to the backend directory and start the app:
```
cd back-end
npm install
npm start
```

### Demo data
The seed needs `MONGODB_URI` and `GOOGLE_BOOKS_API_KEY` in `back-end/.env`.
```
cd back-end
npm run seed   # replace the seed_user_* demo users and their 100 books
```
It fetches every book, cover included, before it deletes the previous seed, so a Google
failure leaves the old data in place. Covers are stored as https; a book Google has no
image for gets Open Library's cover by ISBN when there is one.
