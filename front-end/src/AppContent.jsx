import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './Home';
import Feed from './Feed';
import Browse from './Browse';
import NewlyAdded from './Browse/NewlyAdded';
import MostWanted from './Browse/MostWanted';
import Search from './Browse/Search';
import ByCategory from './Browse/ByCategory';
import Genre from './Browse/ByCategory/Genre';
import Profile from './Profile';
import MyBooks from './Profile/MyBooks';
import MyTrades from './Profile/MyTrades';
import Messages from './Messages';
import MessagesDetail from './MessagesDetail';
import BookPage from './BookPage';
import UserPage from './UserPage';
import UserPageWishlist from './UserPageWishlist';
import UserPageOffered from './UserPageOffered';
import Login from './Login';
import Signup from './Signup';
import ConfirmEmail from './ConfirmEmail';
import ConfirmEmailChange from './ConfirmEmailChange';
import ForgotPassword from './ForgotPassword';
import ResetPassword from './ResetPassword';
import Navbar from './Navbar';
import RequireAuth from './RequireAuth';
import ExchangesList from "./ExchangesList";
import ExchangeDetail from "./ExchangeDetail";

const AppContent = () => {

  // The sign-in screens carry no navigation.
  const location = useLocation();
  const hideNavbarRoutes = ['/login', '/signup', '/confirm-email', '/confirm-email-change', '/forgot-password', '/reset-password'];
  const shouldHideNavbar = hideNavbarRoutes.includes(location.pathname);

  return (
    <div className="app-shell">
      {!shouldHideNavbar && <Navbar />}

      <div className="app-main">
        <Routes>
          <Route index element={<Navigate to="login" replace />} />
          <Route path="login" element={<Login />} />
          <Route path="signup" element={<Signup />} />
          <Route path="confirm-email" element={<ConfirmEmail />} />
          <Route path="confirm-email-change" element={<ConfirmEmailChange />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />

          {/* Everything below needs a signed-in user. */}
          <Route element={<RequireAuth />}>
            <Route path="home" element={<Home />} />
            <Route path="feed" element={<Feed />} />
            <Route path="browse">
              <Route index element={<Browse />} />
              <Route path="newly-added" element={<NewlyAdded />} />
              <Route path="popular" element={<MostWanted />} />
              <Route path="search" element={<Search />} />
              <Route path="by-category">
                <Route index element={<ByCategory />} />
                <Route path=":genre" element={<Genre />} />
              </Route>
            </Route>
            <Route path="/exchanges" element={<ExchangesList />} />
            <Route path="/exchanges/:exchangeId" element={<ExchangeDetail />} />
            <Route path="profile">
              <Route index element={<Profile />} />
              <Route path="edit" element={<Navigate to="/profile" replace />} />
              <Route path="my-books" element={<MyBooks />} />
              <Route path="my-trades" element={<MyTrades />} />
            </Route>
            <Route path="messages" element={<Messages />} />
            <Route path="messages/:user" element={<MessagesDetail />} />
            <Route path="books/:id" element={<BookPage />} />
            <Route path="users/:id" element={<UserPage />} />
            <Route path="users/:id/wishlist" element={<UserPageWishlist />} />
            <Route path="users/:id/offered" element={<UserPageOffered />} />
          </Route>
        </Routes>
      </div>
    </div>
  );
};

export default AppContent;