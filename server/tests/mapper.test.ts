import { describe, expect, it } from 'vitest';
import { mapMovieDetail, mapMovieList, mapMovieSummary } from '../src/tmdb/mapper.js';
import { parseTolerantArray, tmdbMovieDetailSchema, tmdbMovieSummarySchema } from '../src/tmdb/schemas.js';

const genreMap = new Map([
  [28, 'Action'],
  [35, 'Comedy'],
]);

/** A complete, well-behaved TMDB record. */
const goodMovie = {
  id: 550,
  title: 'Fight Club',
  overview: 'An insomniac office worker.',
  poster_path: '/poster.jpg',
  backdrop_path: '/backdrop.jpg',
  release_date: '1999-10-15',
  vote_average: 8.438,
  vote_count: 27_000,
  genre_ids: [28, 35],
  popularity: 61.4,
};

describe('mapMovieSummary', () => {
  it('maps a complete record into the domain shape', () => {
    const parsed = tmdbMovieSummarySchema.parse(goodMovie);
    const movie = mapMovieSummary(parsed, genreMap);

    expect(movie.id).toBe(550);
    expect(movie.releaseYear).toBe(1999);
    // Rounded to one decimal - 8.438 would render as noise.
    expect(movie.rating).toBe(8.4);
    expect(movie.genres).toEqual(['Action', 'Comedy']);
    expect(movie.poster?.medium).toBe('https://image.tmdb.org/t/p/w342/poster.jpg');
    expect(movie.poster?.small).toContain('w185');
  });

  it('degrades gracefully when optional fields are missing entirely', () => {
    // The minimum TMDB could conceivably return: an id and a title.
    const parsed = tmdbMovieSummarySchema.parse({ id: 1, title: 'Untitled' });
    const movie = mapMovieSummary(parsed, genreMap);

    expect(movie.poster).toBeNull();
    expect(movie.backdropUrl).toBeNull();
    expect(movie.overview).toBeNull();
    expect(movie.releaseDate).toBeNull();
    expect(movie.releaseYear).toBeNull();
    expect(movie.rating).toBeNull();
    expect(movie.voteCount).toBe(0);
    expect(movie.genres).toEqual([]);
  });

  it('treats an empty-string release date as no date', () => {
    // TMDB returns "" as often as it returns null for undated films.
    const parsed = tmdbMovieSummarySchema.parse({ ...goodMovie, release_date: '' });
    expect(mapMovieSummary(parsed, genreMap).releaseYear).toBeNull();
  });

  it('reports no rating rather than 0.0 when nothing has been voted on', () => {
    // A 0.0 badge would be a lie about the film; "not rated" is the truth.
    const parsed = tmdbMovieSummarySchema.parse({ ...goodMovie, vote_average: 0, vote_count: 0 });
    expect(mapMovieSummary(parsed, genreMap).rating).toBeNull();
  });

  it('drops genre ids it cannot resolve instead of inventing a label', () => {
    const parsed = tmdbMovieSummarySchema.parse({ ...goodMovie, genre_ids: [28, 9999] });
    expect(mapMovieSummary(parsed, genreMap).genres).toEqual(['Action']);
  });

  it('survives wrong types on optional fields', () => {
    const parsed = tmdbMovieSummarySchema.parse({
      ...goodMovie,
      overview: 42,
      vote_average: 'eight',
      genre_ids: 'not-an-array',
      popularity: null,
    });
    const movie = mapMovieSummary(parsed, genreMap);

    expect(movie.overview).toBeNull();
    expect(movie.rating).toBeNull();
    expect(movie.genreIds).toEqual([]);
    expect(movie.popularity).toBe(0);
  });
});

describe('mapMovieList', () => {
  it('keeps valid records and drops unusable ones without failing the page', () => {
    // This is the behaviour that stops one malformed record taking down a whole grid.
    const { items, dropped } = mapMovieList(
      [goodMovie, { id: 2 /* no title */ }, { title: 'No id' }, null, 'garbage', { ...goodMovie, id: 3 }],
      genreMap,
    );

    expect(items).toHaveLength(2);
    expect(dropped).toBe(4);
    expect(items.map((m) => m.id)).toEqual([550, 3]);
  });

  it('returns an empty list for an empty page rather than throwing', () => {
    expect(mapMovieList([], genreMap)).toEqual({ items: [], dropped: 0 });
  });
});

describe('mapMovieDetail', () => {
  const detail = {
    ...goodMovie,
    tagline: 'Mischief. Mayhem. Soap.',
    runtime: 139,
    status: 'Released',
    original_language: 'en',
    homepage: '',
    imdb_id: 'tt0137523',
    budget: 63_000_000,
    revenue: 0,
    genres: [{ id: 18, name: 'Drama' }],
    credits: {
      cast: [
        { id: 1, name: 'Edward Norton', character: 'The Narrator', profile_path: '/a.jpg', order: 0 },
        { id: 2, name: 'Brad Pitt', character: 'Tyler Durden', profile_path: null, order: 1 },
      ],
      crew: [
        { id: 3, name: 'David Fincher', job: 'Director', department: 'Directing' },
        { id: 3, name: 'David Fincher', job: 'Director', department: 'Production' },
        { id: 4, name: 'Jim Uhls', job: 'Screenplay', department: 'Writing' },
      ],
    },
    videos: {
      results: [
        { key: 'teaser1', name: 'Teaser', site: 'YouTube', type: 'Teaser', official: true },
        { key: 'trailer1', name: 'Official Trailer', site: 'YouTube', type: 'Trailer', official: true },
      ],
    },
    similar: { results: [{ ...goodMovie, id: 99, title: 'Se7en' }] },
  };

  it('maps credits, trailer and similar titles', () => {
    const movie = mapMovieDetail(tmdbMovieDetailSchema.parse(detail), genreMap);

    expect(movie.runtimeMinutes).toBe(139);
    // Detail genre objects win over the id lookup.
    expect(movie.genres).toEqual(['Drama']);
    expect(movie.directors).toEqual(['David Fincher']); // deduped despite two credits
    expect(movie.writers).toEqual(['Jim Uhls']);
    expect(movie.cast).toHaveLength(2);
    expect(movie.cast[0]?.name).toBe('Edward Norton');
    // An official trailer outranks an official teaser.
    expect(movie.trailer?.youtubeUrl).toContain('trailer1');
    expect(movie.similar[0]?.title).toBe('Se7en');
    expect(movie.imdbUrl).toBe('https://www.imdb.com/title/tt0137523/');
  });

  it('treats TMDB zero-as-unknown money fields as unknown', () => {
    const movie = mapMovieDetail(tmdbMovieDetailSchema.parse(detail), genreMap);
    expect(movie.budget).toBe(63_000_000);
    // Rendering "$0" revenue would look like a fact rather than missing data.
    expect(movie.revenue).toBeNull();
    expect(movie.homepage).toBeNull(); // empty string, not a URL
  });

  it('renders a detail page even when every appended block is missing', () => {
    const movie = mapMovieDetail(
      tmdbMovieDetailSchema.parse({ id: 1, title: 'Bare Minimum' }),
      genreMap,
    );

    expect(movie.cast).toEqual([]);
    expect(movie.directors).toEqual([]);
    expect(movie.trailer).toBeNull();
    expect(movie.similar).toEqual([]);
    expect(movie.runtimeMinutes).toBeNull();
  });

  it('ignores trailers hosted somewhere we cannot embed', () => {
    const movie = mapMovieDetail(
      tmdbMovieDetailSchema.parse({
        ...detail,
        videos: { results: [{ key: 'x', name: 'T', site: 'Vimeo', type: 'Trailer', official: true }] },
      }),
      genreMap,
    );
    expect(movie.trailer).toBeNull();
  });
});

describe('parseTolerantArray', () => {
  it('counts what it dropped so upstream drift is observable', () => {
    const { items, dropped } = parseTolerantArray([goodMovie, {}, undefined], tmdbMovieSummarySchema);
    expect(items).toHaveLength(1);
    expect(dropped).toBe(2);
  });
});
