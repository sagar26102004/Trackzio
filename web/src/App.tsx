import { Route, Routes } from 'react-router-dom';
import { Footer } from './components/Footer';
import { Header } from './components/Header';
import { ScrollToTop } from './components/ScrollToTop';
import { BrowsePage } from './pages/BrowsePage';
import { MovieDetailPage } from './pages/MovieDetailPage';
import { WishlistPage } from './pages/WishlistPage';

export function App() {
  return (
    // Column layout with a growing main keeps the footer at the bottom of short
    // pages (an empty wishlist) without resorting to fixed positioning.
    <div className="flex min-h-dvh flex-col">
      <ScrollToTop />
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<BrowsePage />} />
          <Route path="/movie/:id" element={<MovieDetailPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          {/* Anything unrecognised falls back to browse rather than a dead end. */}
          <Route path="*" element={<BrowsePage />} />
        </Routes>
      </main>
      <Footer />
    </div>
  );
}
