export interface LibreTubeSubscription {
    channelId: string;
    url: string;
    name: string;
    avatar?: string;
    avatarUrl?: string;
    verified?: boolean;
    subscriberCount?: number;
    description?: string;
    notificationMode?: number;
}

export interface LibreTubePlaylistBookmark {
    playlistId: string;
    playlistName?: string;
    name?: string;
    thumbnailUrl?: string;
    uploader?: string;
    uploaderUrl?: string;
    videos?: number;
    url?: string;
}

export interface LibreTubeVideo {
    id?: number;
    playlistId?: number;
    videoId?: string;
    title?: string;
    uploadDate?: string;
    uploader?: string;
    thumbnailUrl?: string;
    duration?: number;
    url?: string;
}

export interface LibreTubeLocalPlaylist {
    playlist: {
        id: number;
        name: string;
        thumbnailUrl?: string;
    };
    videos: LibreTubeVideo[];
}

export interface LibreTubeWatchPosition {
    videoId: string;
    position: number;
}

export interface LibreTubeHistoryItem {
    videoId?: string;
    videoIdStr?: string;
    id?: string;
    url?: string;
    title?: string;
    name?: string;
    uploadDate?: string | number;
    uploader?: string;
    uploaderName?: string;
    uploaderUrl?: string;
    uploaderAvatar?: string;
    thumbnailUrl?: string;
    thumbnail?: string;
    duration?: number;
    length?: number;
    accessDate?: number | string;
    accessedAt?: number | string;
    lastWatched?: number | string;
    timestamp?: number | string;
    date?: number | string;
    time?: number | string;
    currentTime?: number;
    position?: number;
    progress?: number;
    repeatCount?: number;
    watchCount?: number;
    playCount?: number;
    repeat_count?: number;
}

export interface LibreTubeBackup {
    watchHistory: LibreTubeHistoryItem[];
    history?: LibreTubeHistoryItem[];
    watch_history?: LibreTubeHistoryItem[];
    watch_history_items?: LibreTubeHistoryItem[];
    subscriptions: LibreTubeSubscription[];
    playlistBookmarks: LibreTubePlaylistBookmark[];
    localPlaylists: LibreTubeLocalPlaylist[];
    preferences?: any[];
    watchPositions: LibreTubeWatchPosition[];
    otherPlaylistKeys?: { [key: string]: any };
}
