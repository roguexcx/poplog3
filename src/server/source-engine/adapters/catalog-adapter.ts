import type {
  CatalogCalendarItem,
  CatalogComment,
  CatalogEpisode,
  CatalogPeople,
  CatalogRatings,
  CatalogSearchResult,
  CatalogSeason,
  CatalogTitle,
  CatalogVideo,
  CalendarParams,
  CommentParams,
  GetEpisodesParams,
  GetSeasonsParams,
  GetTitleParams,
  PeopleParams,
  PopularParams,
  RatingParams,
  RelatedParams,
  SearchParams,
  TrendingParams,
  VideoParams,
} from "../types/catalog.types";

export type { CatalogTitle, CatalogSearchResult, CatalogSeason, CatalogEpisode };

export interface CatalogAdapter {
  searchTitles(params: SearchParams): Promise<CatalogSearchResult[]>;
  getMovie(params: GetTitleParams): Promise<CatalogTitle | null>;
  getShow(params: GetTitleParams): Promise<CatalogTitle | null>;
  getSeasons(params: GetSeasonsParams): Promise<CatalogSeason[]>;
  getEpisodes(params: GetEpisodesParams): Promise<CatalogEpisode[]>;
  getTrending(params: TrendingParams): Promise<CatalogSearchResult[]>;
  getPopular(params: PopularParams): Promise<CatalogSearchResult[]>;
  getRelated(params: RelatedParams): Promise<CatalogSearchResult[]>;
  getRatings(params: RatingParams): Promise<CatalogRatings | null>;
  getComments(params: CommentParams): Promise<CatalogComment[]>;
  getPeople(params: PeopleParams): Promise<CatalogPeople | null>;
  getVideos(params: VideoParams): Promise<CatalogVideo[]>;
  getCalendar(params: CalendarParams): Promise<CatalogCalendarItem[]>;
}
