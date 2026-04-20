export interface VideoListResponse {
  items: Video[];
  nextPageToken?: string;
  pageInfo?: { totalResults: number; resultsPerPage: number };
}

export interface Video {
  id: string;
  snippet?: {
    publishedAt: string;
    channelId: string;
    title: string;
    description: string;
    tags?: string[];
    categoryId?: string;
    thumbnails?: Record<string, { url: string; width: number; height: number }>;
  };
  status?: {
    privacyStatus: "public" | "unlisted" | "private";
    uploadStatus?: string;
    madeForKids?: boolean;
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
    commentCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
}

export interface Channel {
  id: string;
  snippet?: {
    title: string;
    description: string;
    customUrl?: string;
    publishedAt: string;
  };
  statistics?: {
    viewCount: string;
    subscriberCount: string;
    hiddenSubscriberCount: boolean;
    videoCount: string;
  };
  contentDetails?: {
    relatedPlaylists?: { uploads?: string };
  };
}

export interface Playlist {
  id: string;
  snippet?: { title: string; description: string };
  status?: { privacyStatus: "public" | "unlisted" | "private" };
}

export interface CommentThread {
  id: string;
  snippet?: {
    topLevelComment?: {
      id: string;
      snippet: {
        authorDisplayName: string;
        authorChannelId?: { value: string };
        textDisplay: string;
        textOriginal: string;
        likeCount: number;
        publishedAt: string;
        updatedAt: string;
        moderationStatus?: "heldForReview" | "likelySpam" | "published" | "rejected";
      };
    };
    totalReplyCount?: number;
  };
}

export interface AnalyticsResponse {
  columnHeaders: Array<{ name: string; columnType: string; dataType: string }>;
  rows: Array<Array<string | number>>;
  kind?: string;
}
