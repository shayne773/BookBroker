import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Home from './Home';
import Feed from './Feed';
import Browse from './Browse';
import NewlyAdded from './Browse/NewlyAdded';
import PopularNow from './Browse/PopularNow';
import Search from './Browse/Search';
import ByCategory from './Browse/ByCategory';
import Genre from './Browse/ByCategory/Genre';
import Profile from './Profile';
import EditProfile from './Profile/EditProfile';
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
import Navbar from './Navbar';
import RequireAuth from './RequireAuth';
import ExchangesList from "./ExchangesList";
import ExchangeDetail from "./ExchangeDetail";

const AppContent = () => {

  //variables for navbar conditionals
  const location = useLocation();
  const hideNavbarRoutes = ['/login', '/signup'];
  const shouldHideNavbar = hideNavbarRoutes.includes(location.pathname);

  return (
    <>
      <Routes>
        <Route index element={<Navigate to="login" replace />} />
        <Route path="login" element={<Login />} />
        <Route path="signup" element={<Signup />} />

        {/* Everything below needs a signed-in user. */}
        <Route element={<RequireAuth />}>
          <Route path="home" element={<Home />} />
          <Route path="feed" element={<Feed />} />
          <Route path="browse">
            <Route index element={<Browse />} />
            <Route path="newly-added" element={<NewlyAdded />} />
            <Route path="popular" element={<PopularNow />} />
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
            <Route path="edit" element={<EditProfile />} />
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

      {!shouldHideNavbar && <Navbar />}
    </>
  );
};

export default AppContent;