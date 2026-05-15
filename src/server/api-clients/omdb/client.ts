const OMDB_BASE_URL = "https://www.omdbapi.com/";

type OmdbFetchParams = {
  imdbId?: string;
  title?: string;
};

function buildOmdbUrl(params: OmdbFetchParams) {
  const url = new URL(OMDB_BASE_URL);

  const apiKey = process.env.OMDB_API_KEY;

  if (!apiKey) {
    throw new Error("OMDB_API_KEY não configurada.");
  }

  url.searchParams.set("apikey", apiKey);

  if (params.imdbId) {
    url.searchParams.set("i", params.imdbId);
  }

  if (params.title) {
    url.searchParams.set("t", params.title);
  }

  return url.toString();
}

export async function omdbFetch<T>(params: OmdbFetchParams): Promise<T> {
  const response = await fetch(buildOmdbUrl(params), {
    next: {
      revalidate: 60 * 60 * 24 * 30,
    },
  });

  if (!response.ok) {
    throw new Error(`OMDb request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}