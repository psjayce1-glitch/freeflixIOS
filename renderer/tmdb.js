const TMDB_IMG = "https://image.tmdb.org/t/p/w500";
const TMDB_BACKDROP = "https://image.tmdb.org/t/p/w1280";

const GENRES = { movie: {}, tv: {} };

async function tmdbFetch(endpoint, params = {}) {
  return window.freeflix.tmdbGet(endpoint, params);
}

function yearOf(raw) {
  const date = raw.release_date || raw.first_air_date || "";
  return date.slice(0, 4) || "";
}

function isNew(raw) {
  const date = raw.release_date || raw.first_air_date;
  if (!date) return false;
  const then = new Date(date).getTime();
  if (Number.isNaN(then)) return false;
  return Date.now() - then < 1000 * 60 * 60 * 24 * 120;
}

function tagsFor(raw, kind) {
  const ids = raw.genre_ids || [];
  return ids.map((id) => GENRES[kind]?.[id]).filter(Boolean);
}

function mapTitle(raw, kind, extra = {}) {
  const type = kind === "tv" ? "series" : "movie";
  return {
    id: `tmdb-${type}-${raw.id}`,
    tmdbId: raw.id,
    kind,
    title: raw.title || raw.name,
    type,
    year: yearOf(raw),
    rating: raw.vote_average ? `${raw.vote_average.toFixed(1)} TMDB` : "",
    runtime: "",
    tags: tagsFor(raw, kind),
    new: isNew(raw),
    featured: false,
    synopsis: raw.overview || "No synopsis available.",
    poster: raw.poster_path ? TMDB_IMG + raw.poster_path : "",
    still: raw.backdrop_path
      ? TMDB_BACKDROP + raw.backdrop_path
      : raw.poster_path
        ? TMDB_IMG + raw.poster_path
        : "",
    src: null,
    ...extra,
  };
}

function mergeById(lists) {
  const map = new Map();
  for (const list of lists) {
    for (const item of list) {
      const prev = map.get(item.id);
      if (!prev) {
        map.set(item.id, { ...item });
        continue;
      }
      map.set(item.id, {
        ...prev,
        ...item,
        new: prev.new || item.new,
        featured: prev.featured || item.featured,
        rows: [...new Set([...(prev.rows || []), ...(item.rows || [])])],
      });
    }
  }
  return [...map.values()];
}

async function loadGenres() {
  try {
    const [movies, tv] = await Promise.all([
      tmdbFetch("/genre/movie/list"),
      tmdbFetch("/genre/tv/list"),
    ]);
    for (const g of movies.genres || []) GENRES.movie[g.id] = g.name;
    for (const g of tv.genres || []) GENRES.tv[g.id] = g.name;
  } catch (err) {
    console.warn("Could not load genres:", err);
  }
}

function fromResults(data, kind, row) {
  return (data.results || [])
    .filter((raw) => raw.poster_path || raw.backdrop_path)
    .map((raw) => mapTitle(raw, kind, { rows: [row] }));
}

async function fetchTmdbCatalog() {
  await loadGenres();
  const [
    trending,
    popularMovies,
    popularSeries,
    nowPlaying,
    upcoming,
    topMovies,
    onAir,
    topSeries,
  ] = await Promise.all([
    tmdbFetch("/trending/all/week").catch(() => ({ results: [] })),
    tmdbFetch("/movie/popular").catch(() => ({ results: [] })),
    tmdbFetch("/tv/popular").catch(() => ({ results: [] })),
    tmdbFetch("/movie/now_playing").catch(() => ({ results: [] })),
    tmdbFetch("/movie/upcoming").catch(() => ({ results: [] })),
    tmdbFetch("/movie/top_rated").catch(() => ({ results: [] })),
    tmdbFetch("/tv/on_the_air").catch(() => ({ results: [] })),
    tmdbFetch("/tv/top_rated").catch(() => ({ results: [] })),
  ]);

  const trendingMapped = (trending.results || [])
    .filter((raw) => raw.media_type === "movie" || raw.media_type === "tv")
    .filter((raw) => raw.poster_path || raw.backdrop_path)
    .map((raw) =>
      mapTitle(raw, raw.media_type === "tv" ? "tv" : "movie", {
        rows: ["trending"],
        featured: Boolean(raw.backdrop_path),
      })
    );

  if (trendingMapped[0]) trendingMapped[0].featured = true;

  return mergeById([
    trendingMapped,
    fromResults(popularMovies, "movie", "popular"),
    fromResults(popularSeries, "tv", "popular"),
    fromResults(nowPlaying, "movie", "now"),
    fromResults(upcoming, "movie", "upcoming"),
    fromResults(topMovies, "movie", "top"),
    fromResults(onAir, "tv", "now"),
    fromResults(topSeries, "tv", "top"),
  ]);
}

async function searchTmdb(query) {
  const data = await tmdbFetch("/search/multi", { query });
  return (data.results || [])
    .filter((raw) => raw.media_type === "movie" || raw.media_type === "tv")
    .filter((raw) => raw.poster_path || raw.backdrop_path)
    .map((raw) => mapTitle(raw, raw.media_type === "tv" ? "tv" : "movie", { rows: ["search"] }));
}

async function fetchTmdbShowSeasons(tmdbId) {
  const show = await tmdbFetch(`/tv/${tmdbId}`);
  return (show.seasons || [])
    .filter((season) => Number.isInteger(season.season_number) && season.episode_count > 0)
    .map((season) => ({
      number: season.season_number,
      name: season.name || (season.season_number === 0 ? "Specials" : `Season ${season.season_number}`),
      episodeCount: season.episode_count,
    }))
    .sort((left, right) => left.number - right.number);
}

async function fetchTmdbSeasonEpisodes(tmdbId, seasonNumber) {
  const season = await tmdbFetch(`/tv/${tmdbId}/season/${seasonNumber}`);
  return (season.episodes || [])
    .filter((episode) => Number.isInteger(episode.episode_number))
    .map((episode) => ({
      number: episode.episode_number,
      name: episode.name || `Episode ${episode.episode_number}`,
      still: episode.still_path ? `https://image.tmdb.org/t/p/w500${episode.still_path}` : "",
      overview: episode.overview || "",
      runtime: Number.isFinite(episode.runtime) ? episode.runtime : 0,
    }))
    .sort((left, right) => left.number - right.number);
}

async function fetchTmdbTrailer(item) {
  try {
    const path = item.kind === "tv" ? `/tv/${item.tmdbId}/videos` : `/movie/${item.tmdbId}/videos`;
    const data = await tmdbFetch(path);
    const videos = data.results || [];
    const pick =
      videos.find((v) => v.site === "YouTube" && v.type === "Trailer" && v.official) ||
      videos.find((v) => v.site === "YouTube" && v.type === "Trailer") ||
      videos.find((v) => v.site === "YouTube");
    return pick ? `https://www.youtube-nocookie.com/embed/${pick.key}?autoplay=1&rel=0` : null;
  } catch (e) {
    return null;
  }
}
