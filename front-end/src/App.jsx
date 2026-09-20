// App.jsx
// I moved the routing to AppContent.jsx for uselocation to work (for navbar)
import { BrowserRouter as Router } from 'react-router-dom';
import AppContent from './AppContent';

const App = () => (
  <Router basename={import.meta.env.BASE_URL}>
    <AppContent />
  </Router>
);

export default App;