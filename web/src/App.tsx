import { Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { BrowsePage } from './pages/BrowsePage';
import { MovieDetailPage } from './pages/MovieDetailPage';
import { WishlistPage } from './pages/WishlistPage';

export function App() {
  return (
    <div className="min-h-dvh">
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/movie/:id" element={<MovieDetailPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          {/* Anything unrecognised falls back to browse rather than a dead end. */}
          <Route path="*" element={<BrowsePage />} />
        </Routes>
      </main>
    </div>
  );
}
