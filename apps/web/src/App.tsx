import { BrowserRouter, Route, Routes } from 'react-router-dom';
import NewShedPage from './pages/NewShedPage';
import RcAttachPage from './pages/RcAttachPage';
import ShedDetailPage from './pages/ShedDetailPage';
import ShedsPage from './pages/ShedsPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<ShedsPage />} />
        <Route path="/new" element={<NewShedPage />} />
        <Route path="/sheds/:host/:name" element={<ShedDetailPage />} />
        <Route path="/sheds/:host/:name/rc/:slug/attach" element={<RcAttachPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
