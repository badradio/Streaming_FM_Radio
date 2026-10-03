export type RecentItem = {
  artist: string;
  title: string;
};

export type NowPlayingProps = {
  badge: string;
  artist: string;
  title: string | undefined;
  album: string;
  year: number | undefined;
  empty: boolean;
};
