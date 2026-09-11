import { useEffect } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

/**
 * Scroll behaviour on navigation.
 *
 * React Router does not touch scroll position, so following a link from halfway
 * down the grid drops you halfway down the movie's detail page. But the naive fix -
 * scrolling to top on every navigation - breaks the requirement in the other
 * direction: pressing Back should return you to the grid exactly where you left it,
 * and forcing the top would destroy precisely the context we are meant to preserve.
 *
 * So the rule is conditional:
 *
 *   PUSH / REPLACE  a new destination -> start at the top
 *   POP             back or forward   -> leave it alone, and let the browser
 *                                        restore the previous offset
 *
 * Keyed on pathname only, deliberately. Filter and search changes rewrite the query
 * string on the same path, and yanking the page to the top on every keystroke would
 * be worse than useless.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType === 'POP') return;
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [pathname, navigationType]);

  return null;
}
