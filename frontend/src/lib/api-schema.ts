export interface paths {
    "/api/v1/auth/google": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_google"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/google/callback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AuthController_googleCallback"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/refresh": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_refresh"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/auth/logout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AuthController_logout"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_check"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health/live": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["HealthController_live"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_me"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_search"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/users/admins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_admins"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UsersController_adminList"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["UsersController_adminUpdate"];
        trace?: never;
    };
    "/api/v1/workspaces": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_list"];
        put?: never;
        post: operations["WorkspacesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_get"];
        put?: never;
        post?: never;
        delete: operations["WorkspacesController_remove"];
        options?: never;
        head?: never;
        patch: operations["WorkspacesController_update"];
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["WorkspacesController_members"];
        put?: never;
        post: operations["WorkspacesController_addMember"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/members/{userId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["WorkspacesController_removeMember"];
        options?: never;
        head?: never;
        patch: operations["WorkspacesController_updateMember"];
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/nodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NodesController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/folders": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NodesController_createFolder"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NodesController_get"];
        put?: never;
        post?: never;
        delete: operations["NodesController_trash"];
        options?: never;
        head?: never;
        patch: operations["NodesController_rename"];
        trace?: never;
    };
    "/api/v1/nodes/{id}/activity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NodesController_activity"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/breadcrumb": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NodesController_breadcrumb"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/move": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NodesController_move"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/shared-with-me": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NodesController_sharedWithMe"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/trash": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["TrashController_list"];
        put?: never;
        post?: never;
        delete: operations["TrashController_empty"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["TrashController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/permanent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["TrashController_deletePermanently"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/shares": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SharesController_list"];
        put?: never;
        post: operations["SharesController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/shares/{shareId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["SharesController_remove"];
        options?: never;
        head?: never;
        patch: operations["SharesController_update"];
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_listTags"];
        put?: never;
        post: operations["LibraryController_createTag"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/tags/{tagId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["LibraryController_deleteTag"];
        options?: never;
        head?: never;
        patch: operations["LibraryController_updateTag"];
        trace?: never;
    };
    "/api/v1/nodes/{id}/tags": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["LibraryController_setNodeTags"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/favorite": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["LibraryController_addFavorite"];
        post?: never;
        delete: operations["LibraryController_removeFavorite"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/favorites": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_favorites"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/recent": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_recent"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/recently-updated": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["LibraryController_recentlyUpdated"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/uploads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["UploadsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UploadsController_status"];
        put?: never;
        post?: never;
        delete: operations["UploadsController_abort"];
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{id}/parts": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["UploadsController_parts"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/uploads/{id}/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["UploadsController_complete"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/duplicates": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_duplicates"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_versions"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_preview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/thumbnail": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_thumbnail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/download": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_download"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/download-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FilesController_downloadLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/downloads/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_redeem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/versions/{versionId}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FilesController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/regenerate": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["FilesController_regenerate"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/nodes/{id}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_events"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/storage": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["FilesController_storage"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_detail"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch: operations["VideosController_updateInfo"];
        trace?: never;
    };
    "/api/v1/videos/{id}/playback": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["VideosController_playback"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/hls/master.m3u8": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_master"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/hls/{rendition}/index.m3u8": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_media"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/hls/{rendition}/{segment}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_segment"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_key"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/progress": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: operations["VideosController_progress"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/poster": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_poster"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/sprite.vtt": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["VideosController_sprite"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/videos/{id}/retranscode": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["VideosController_retranscode"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/videos": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminVideosController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/videos/{id}/original-link": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["AdminVideosController_originalLink"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/downloads/video/{token}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminVideoDownloadController_redeem"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notifications": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationsController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notifications/read": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["NotificationsController_read"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/me/notifications/stream": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["NotificationsController_stream"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/workspaces/{wsId}/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DocumentsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/copy": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DocumentsController_copy"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/collab-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_collabToken"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_listAssets"];
        put?: never;
        post: operations["DocumentsController_uploadAsset"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/files/{id}/convert-to-document": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DocumentsController_importDocx"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_listVersions"];
        put?: never;
        post: operations["DocumentsController_createVersion"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/versions/{vid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_getVersion"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/versions/{vid}/diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["DocumentsController_diff"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/versions/{vid}/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DocumentsController_restore"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{id}/threads": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["CommentsController_list"];
        put?: never;
        post: operations["CommentsController_create"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/threads/{tid}/comments": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CommentsController_reply"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/comments/{cid}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        delete: operations["CommentsController_remove"];
        options?: never;
        head?: never;
        patch: operations["CommentsController_edit"];
        trace?: never;
    };
    "/api/v1/threads/{tid}/resolve": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CommentsController_resolve"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/threads/{tid}/reopen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["CommentsController_reopen"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/stats": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminController_overview"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-logs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminController_list"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/audit-logs/export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["AdminController_export"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/search": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: operations["SearchController_find"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/admin/search/reindex": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["SearchController_reindex"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/dev/token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: operations["DevAuthController_token"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        Error: {
            error: {
                code: "VALIDATION_ERROR" | "UNAUTHENTICATED" | "SESSION_EXPIRED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "TOO_LARGE" | "UNSUPPORTED_TYPE" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "INTERNAL_ERROR";
                message: string;
                details?: unknown;
                requestId?: string;
            };
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    AuthController_google: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_googleCallback: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_refresh: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        tokenType: "Bearer";
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                            isSystemAdmin: boolean;
                        };
                    };
                };
            };
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AuthController_logout: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    HealthController_check: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status?: "ok" | "degraded";
                        info?: {
                            [key: string]: {
                                status: "up" | "degraded" | "down";
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        error?: {
                            [key: string]: {
                                status: "up" | "degraded" | "down";
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        details?: {
                            [key: string]: {
                                status: "up" | "degraded" | "down";
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status?: "error" | "shutting_down";
                        info?: {
                            [key: string]: {
                                status: "up" | "degraded" | "down";
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        error?: {
                            [key: string]: {
                                status: "up" | "degraded" | "down";
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        } | null;
                        details?: {
                            [key: string]: {
                                status: "up" | "degraded" | "down";
                                responseTime?: number;
                            } & {
                                [key: string]: unknown;
                            };
                        };
                    };
                };
            };
        };
    };
    HealthController_live: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": string;
                };
            };
        };
    };
    UsersController_me: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        name: string;
                        avatarUrl: string | null;
                        isSystemAdmin: boolean;
                        workspaces: {
                            id: string;
                            name: string;
                            slug: string;
                            icon: string | null;
                            kind: "COMPANY" | "TEAM";
                            role: "ADMIN" | "MEMBER" | "VIEWER";
                        }[];
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_search: {
        parameters: {
            query: {
                q: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        name: string;
                        avatarUrl: string | null;
                    }[];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_admins: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        name: string;
                        avatarUrl: string | null;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_adminList: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
                q?: string;
                status?: "ACTIVE" | "DISABLED";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                            isSystemAdmin: boolean;
                            status: "ACTIVE" | "DISABLED";
                            lastLoginAt: string | null;
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UsersController_adminUpdate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    status?: "ACTIVE" | "DISABLED";
                    isSystemAdmin?: boolean;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        email: string;
                        name: string;
                        avatarUrl: string | null;
                        isSystemAdmin: boolean;
                        status: "ACTIVE" | "DISABLED";
                        lastLoginAt: string | null;
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_list: {
        parameters: {
            query?: {
                scope?: "mine" | "all";
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        slug: string;
                        description: string | null;
                        icon: string | null;
                        createdAt: string;
                        kind: "COMPANY" | "TEAM";
                        memberCount: number;
                        myRole: "ADMIN" | "MEMBER" | "VIEWER" | null;
                    }[];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    slug: string;
                    description?: string;
                    icon?: string;
                    memberEmails?: string[];
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        slug: string;
                        description: string | null;
                        icon: string | null;
                        createdAt: string;
                        kind: "COMPANY" | "TEAM";
                        memberCount: number;
                        myRole: "ADMIN" | "MEMBER" | "VIEWER" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        slug: string;
                        description: string | null;
                        icon: string | null;
                        createdAt: string;
                        kind: "COMPANY" | "TEAM";
                        memberCount: number;
                        myRole: "ADMIN" | "MEMBER" | "VIEWER" | null;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    description?: string | null;
                    icon?: string | null;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        slug: string;
                        description: string | null;
                        icon: string | null;
                        createdAt: string;
                        kind: "COMPANY" | "TEAM";
                        memberCount: number;
                        myRole: "ADMIN" | "MEMBER" | "VIEWER" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_members: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        role: "ADMIN" | "MEMBER" | "VIEWER";
                        createdAt: string;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_addMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    role?: "ADMIN" | "MEMBER" | "VIEWER";
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        role: "ADMIN" | "MEMBER" | "VIEWER";
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_removeMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    WorkspacesController_updateMember: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
                userId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    role: "ADMIN" | "MEMBER" | "VIEWER";
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        role: "ADMIN" | "MEMBER" | "VIEWER";
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_list: {
        parameters: {
            query?: {
                parentId?: string;
                section?: "DOCS" | "VIDEOS";
                type?: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                sort?: "name" | "updatedAt" | "createdAt";
                order?: "asc" | "desc";
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_createFolder: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    parentId?: string | null;
                    section?: "DOCS" | "VIDEOS";
                    name: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_trash: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_rename: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_activity: {
        parameters: {
            query?: {
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            action: string;
                            actor: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            } | null;
                            metadata: {
                                [key: string]: unknown;
                            };
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_breadcrumb: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_move: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    targetParentId: string | null;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NodesController_sharedWithMe: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        shareRole: "EDITOR" | "VIEWER";
                        sharedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        sharedAt: string;
                        workspace: {
                            id: string;
                            name: string;
                            slug: string;
                        };
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TrashController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        parentId: string | null;
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        deletedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        deletedAt: string;
                        itemCount: number;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TrashController_empty: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        deleted: number;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TrashController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        } | null;
                        name: string;
                        movedToRoot: boolean;
                        renamed: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    TrashController_deletePermanently: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    SharesController_list: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        direct: {
                            id: string;
                            user: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            role: "EDITOR" | "VIEWER";
                            grantedBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            } | null;
                            createdAt: string;
                        }[];
                        inherited: {
                            id: string;
                            user: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            role: "EDITOR" | "VIEWER";
                            grantedBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            } | null;
                            createdAt: string;
                            fromNode: {
                                id: string;
                                name: string;
                            };
                        }[];
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    SharesController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    role: "EDITOR" | "VIEWER";
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        role: "EDITOR" | "VIEWER";
                        grantedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    SharesController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                shareId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    SharesController_update: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                shareId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    role: "EDITOR" | "VIEWER";
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        role: "EDITOR" | "VIEWER";
                        grantedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_listTags: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        color: string;
                        createdAt: string;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_createTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                    color: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        color: string;
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_deleteTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tagId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_updateTag: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tagId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name?: string;
                    color?: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        color: string;
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_setNodeTags: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    tagIds: string[];
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_addFavorite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_removeFavorite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_favorites: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_recent: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        viewedAt: string;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    LibraryController_recentlyUpdated: {
        parameters: {
            query?: {
                section?: "DOCS" | "VIDEOS";
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UploadsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    parentId?: string | null;
                    fileName: string;
                    size: number;
                    mime?: string;
                    kind?: "FILE" | "VIDEO";
                    replaceNodeId?: string;
                    title?: string;
                    description?: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uploadId: string;
                        nodeId: string;
                        fileName: string;
                        size: number;
                        kind: "FILE" | "VIDEO";
                        isNewVersion: boolean;
                        status: "PENDING" | "COMPLETED" | "ABORTED";
                        partSize: number;
                        partCount: number;
                        expiresAt: string;
                        parts: {
                            partNumber: number;
                            url: string;
                        }[];
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UploadsController_status: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uploadId: string;
                        nodeId: string;
                        fileName: string;
                        size: number;
                        kind: "FILE" | "VIDEO";
                        isNewVersion: boolean;
                        status: "PENDING" | "COMPLETED" | "ABORTED";
                        partSize: number;
                        partCount: number;
                        expiresAt: string;
                        uploadedParts: {
                            partNumber: number;
                            size: number;
                            etag: string;
                        }[];
                        uploadedBytes: number;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UploadsController_abort: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UploadsController_parts: {
        parameters: {
            query?: {
                from?: number;
                to?: number;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        parts: {
                            partNumber: number;
                            url: string;
                        }[];
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    UploadsController_complete: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    parts?: {
                        partNumber: number;
                        etag: string;
                    }[];
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        uploadId: string;
                        nodeId: string;
                        fileName: string;
                        size: number;
                        kind: "FILE" | "VIDEO";
                        isNewVersion: boolean;
                        status: "PENDING" | "COMPLETED" | "ABORTED";
                        partSize: number;
                        partCount: number;
                        expiresAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        currentVersion: {
                            id: string;
                            versionNo: number;
                            fileName: string;
                            size: number;
                            mime: string;
                            sha256: string | null;
                            previewKind: "pdf" | "image" | "text" | "none";
                            hasThumbnail: boolean;
                            uploadedBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            isCurrent: boolean;
                        } | null;
                        versionCount: number;
                        processingError: string | null;
                        canDownload: boolean;
                        duplicates: {
                            id: string;
                            name: string;
                            type: "FILE" | "VIDEO";
                            section: "DOCS" | "VIDEOS";
                            workspace: {
                                id: string;
                                name: string;
                            };
                        }[];
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_duplicates: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        duplicates: {
                            id: string;
                            name: string;
                            type: "FILE" | "VIDEO";
                            section: "DOCS" | "VIDEOS";
                            workspace: {
                                id: string;
                                name: string;
                            };
                        }[];
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_versions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        versionNo: number;
                        fileName: string;
                        size: number;
                        mime: string;
                        sha256: string | null;
                        previewKind: "pdf" | "image" | "text" | "none";
                        hasThumbnail: boolean;
                        uploadedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        isCurrent: boolean;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_preview: {
        parameters: {
            query?: {
                version?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        kind: "pdf" | "image" | "text" | "none";
                        mime: string | null;
                        url: string | null;
                        expiresAt: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_thumbnail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_download: {
        parameters: {
            query?: {
                version?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_downloadLink: {
        parameters: {
            query?: {
                version?: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        url: string;
                        expiresAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_redeem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                versionId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        currentVersion: {
                            id: string;
                            versionNo: number;
                            fileName: string;
                            size: number;
                            mime: string;
                            sha256: string | null;
                            previewKind: "pdf" | "image" | "text" | "none";
                            hasThumbnail: boolean;
                            uploadedBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            isCurrent: boolean;
                        } | null;
                        versionCount: number;
                        processingError: string | null;
                        canDownload: boolean;
                        duplicates: {
                            id: string;
                            name: string;
                            type: "FILE" | "VIDEO";
                            section: "DOCS" | "VIDEOS";
                            workspace: {
                                id: string;
                                name: string;
                            };
                        }[];
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_regenerate: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_events: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    FilesController_storage: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        totalBytes: number;
                        originalBytes: number;
                        derivedBytes: number;
                        fileCount: number;
                        trashBytes: number;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_detail: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        video: {
                            durationSec: number;
                            width: number;
                            height: number;
                            renditions: {
                                name: string;
                                width: number;
                                height: number;
                                bandwidth: number;
                            }[];
                            viewCount: number;
                            transcodedAt: string;
                        } | null;
                        processingError: string | null;
                        resumeAt: number | null;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_updateInfo: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    title: string;
                    description: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        workspaceId: string;
                        parentId: string | null;
                        type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                        name: string;
                        description: string | null;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        updatedAt: string;
                        myRole: "VIEWER" | "EDITOR" | "OWNER";
                        section: "DOCS" | "VIDEOS";
                        isFavorite: boolean;
                        tags: {
                            id: string;
                            name: string;
                            color: string;
                        }[];
                        childCount: number | null;
                        size: number | null;
                        mime: string | null;
                        documentFormat: "RICH" | "LATEX" | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_playback: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        masterUrl: string;
                        token: string;
                        expiresAt: string;
                        posterUrl: string | null;
                        watermark: {
                            name: string;
                            email: string;
                        };
                        resumeAt: number | null;
                        durationSec: number;
                        maxHeight: number | null;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_master: {
        parameters: {
            query: {
                s: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.apple.mpegurl": string;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_media: {
        parameters: {
            query: {
                s: string;
            };
            header?: never;
            path: {
                id: string;
                rendition: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/vnd.apple.mpegurl": string;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_segment: {
        parameters: {
            query: {
                s: string;
            };
            header?: never;
            path: {
                id: string;
                rendition: string;
                segment: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_key: {
        parameters: {
            query: {
                s: string;
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_progress: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    positionSec: number;
                };
            };
        };
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_poster: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            302: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_sprite: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/vtt": string;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    VideosController_retranscode: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AdminVideosController_list: {
        parameters: {
            query?: {
                q?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        name: string;
                        status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                        workspace: {
                            id: string;
                            name: string;
                        };
                        size: number | null;
                        durationSec: number | null;
                        viewCount: number;
                        createdBy: {
                            id: string;
                            name: string;
                            email: string;
                        };
                        createdAt: string;
                    }[];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AdminVideosController_originalLink: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        url: string;
                        expiresAt: string;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AdminVideoDownloadController_redeem: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                token: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/octet-stream": string;
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NotificationsController_list: {
        parameters: {
            query?: {
                unread?: "true" | "false";
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            type: string;
                            payload: {
                                [key: string]: unknown;
                            };
                            readAt: string | null;
                            createdAt: string;
                        }[];
                        nextCursor: string | null;
                        unreadCount: number;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NotificationsController_read: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    ids?: string[];
                    all?: boolean;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        updated: number;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    NotificationsController_stream: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/event-stream": string;
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                wsId: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    parentId?: string | null;
                    name: string;
                    format?: "RICH" | "LATEX";
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        format: "RICH" | "LATEX";
                        contentJson: unknown;
                        wordCount: number;
                        lastEditedAt: string | null;
                        lastEditedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        versionCount: number;
                        readOnly: boolean;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_get: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        format: "RICH" | "LATEX";
                        contentJson: unknown;
                        wordCount: number;
                        lastEditedAt: string | null;
                        lastEditedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        versionCount: number;
                        readOnly: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_copy: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    workspaceId?: string;
                    parentId?: string | null;
                    name?: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        format: "RICH" | "LATEX";
                        contentJson: unknown;
                        wordCount: number;
                        lastEditedAt: string | null;
                        lastEditedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        versionCount: number;
                        readOnly: boolean;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_collabToken: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        token: string;
                        documentName: string;
                        url: string;
                        readOnly: boolean;
                        expiresAt: string;
                        user: {
                            id: string;
                            name: string;
                        };
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_export: {
        parameters: {
            query?: {
                format?: "html" | "md" | "tex";
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/html": string;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_listAssets: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        fileName: string;
                        mime: string;
                        size: number;
                        url: string;
                        isImage: boolean;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_uploadAsset: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": {
                    file: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        fileName: string;
                        mime: string;
                        size: number;
                        url: string;
                        isImage: boolean;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_importDocx: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        node: {
                            id: string;
                            workspaceId: string;
                            parentId: string | null;
                            type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                            name: string;
                            description: string | null;
                            status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                            createdBy: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            createdAt: string;
                            updatedAt: string;
                            myRole: "VIEWER" | "EDITOR" | "OWNER";
                            section: "DOCS" | "VIDEOS";
                            isFavorite: boolean;
                            tags: {
                                id: string;
                                name: string;
                                color: string;
                            }[];
                            childCount: number | null;
                            size: number | null;
                            mime: string | null;
                            documentFormat: "RICH" | "LATEX" | null;
                        };
                        format: "RICH" | "LATEX";
                        contentJson: unknown;
                        wordCount: number;
                        lastEditedAt: string | null;
                        lastEditedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        versionCount: number;
                        readOnly: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_listVersions: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        versionNo: number;
                        name: string | null;
                        isAuto: boolean;
                        restoredFrom: {
                            id: string;
                            versionNo: number;
                        } | null;
                        wordCount: number;
                        wordsAdded: number;
                        wordsRemoved: number;
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        createdAt: string;
                    }[];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_createVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    name: string;
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        versionNo: number;
                        name: string | null;
                        isAuto: boolean;
                        restoredFrom: {
                            id: string;
                            versionNo: number;
                        } | null;
                        wordCount: number;
                        wordsAdded: number;
                        wordsRemoved: number;
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        createdAt: string;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_getVersion: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                vid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        versionNo: number;
                        name: string | null;
                        isAuto: boolean;
                        restoredFrom: {
                            id: string;
                            versionNo: number;
                        } | null;
                        wordCount: number;
                        wordsAdded: number;
                        wordsRemoved: number;
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        createdAt: string;
                        contentJson: unknown;
                        html: string;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_diff: {
        parameters: {
            query?: {
                with?: string;
            };
            header?: never;
            path: {
                id: string;
                vid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        from: {
                            id: string;
                            versionNo: number;
                        };
                        to: {
                            id: string;
                            versionNo: number | null;
                        };
                        stats: {
                            added: number;
                            removed: number;
                        };
                        parts: {
                            type: "same" | "added" | "removed";
                            text: string;
                        }[];
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DocumentsController_restore: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
                vid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        versionNo: number;
                        name: string | null;
                        isAuto: boolean;
                        restoredFrom: {
                            id: string;
                            versionNo: number;
                        } | null;
                        wordCount: number;
                        wordsAdded: number;
                        wordsRemoved: number;
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        createdAt: string;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_list: {
        parameters: {
            query?: {
                status?: "OPEN" | "RESOLVED" | "ALL";
            };
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        quotedText: string;
                        status: "OPEN" | "RESOLVED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        resolvedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        resolvedAt: string | null;
                        comments: {
                            id: string;
                            body: string;
                            author: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            mentions: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            }[];
                            createdAt: string;
                            editedAt: string | null;
                            canEdit: boolean;
                            canDelete: boolean;
                        }[];
                        canResolve: boolean;
                    }[];
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_create: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    quotedText?: string;
                    body: string;
                    mentions?: string[];
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        quotedText: string;
                        status: "OPEN" | "RESOLVED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        resolvedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        resolvedAt: string | null;
                        comments: {
                            id: string;
                            body: string;
                            author: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            mentions: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            }[];
                            createdAt: string;
                            editedAt: string | null;
                            canEdit: boolean;
                            canDelete: boolean;
                        }[];
                        canResolve: boolean;
                        ignoredMentions: string[];
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_reply: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    body: string;
                    mentions?: string[];
                };
            };
        };
        responses: {
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        quotedText: string;
                        status: "OPEN" | "RESOLVED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        resolvedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        resolvedAt: string | null;
                        comments: {
                            id: string;
                            body: string;
                            author: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            mentions: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            }[];
                            createdAt: string;
                            editedAt: string | null;
                            canEdit: boolean;
                            canDelete: boolean;
                        }[];
                        canResolve: boolean;
                        ignoredMentions: string[];
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_remove: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        threadDeleted: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_edit: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                cid: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    body: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        quotedText: string;
                        status: "OPEN" | "RESOLVED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        resolvedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        resolvedAt: string | null;
                        comments: {
                            id: string;
                            body: string;
                            author: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            mentions: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            }[];
                            createdAt: string;
                            editedAt: string | null;
                            canEdit: boolean;
                            canDelete: boolean;
                        }[];
                        canResolve: boolean;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_resolve: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        quotedText: string;
                        status: "OPEN" | "RESOLVED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        resolvedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        resolvedAt: string | null;
                        comments: {
                            id: string;
                            body: string;
                            author: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            mentions: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            }[];
                            createdAt: string;
                            editedAt: string | null;
                            canEdit: boolean;
                            canDelete: boolean;
                        }[];
                        canResolve: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    CommentsController_reopen: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                tid: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        id: string;
                        quotedText: string;
                        status: "OPEN" | "RESOLVED";
                        createdBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        };
                        createdAt: string;
                        resolvedBy: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                        } | null;
                        resolvedAt: string | null;
                        comments: {
                            id: string;
                            body: string;
                            author: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            };
                            mentions: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            }[];
                            createdAt: string;
                            editedAt: string | null;
                            canEdit: boolean;
                            canDelete: boolean;
                        }[];
                        canResolve: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            404: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AdminController_overview: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        users: {
                            total: number;
                            active: number;
                            disabled: number;
                            systemAdmins: number;
                            activeLast7Days: number;
                        };
                        workspaces: {
                            total: number;
                        };
                        content: {
                            folders: number;
                            documents: number;
                            files: number;
                            videos: number;
                            inTrash: number;
                        };
                        activity: {
                            last7Days: {
                                date: string;
                                count: number;
                            }[];
                            loginsLast7Days: number;
                            failedLoginsLast7Days: number;
                        };
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AdminController_list: {
        parameters: {
            query?: {
                actorId?: string;
                actions?: string;
                workspaceId?: string;
                targetId?: string;
                from?: string;
                to?: string;
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            id: string;
                            createdAt: string;
                            action: string;
                            actor: {
                                id: string;
                                email: string;
                                name: string;
                                avatarUrl: string | null;
                            } | null;
                            target: {
                                type: string;
                                id: string;
                                label: string | null;
                            } | null;
                            workspace: {
                                id: string;
                                name: string;
                            } | null;
                            metadata: unknown;
                            ip: string | null;
                            userAgent: string | null;
                        }[];
                        nextCursor: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    AdminController_export: {
        parameters: {
            query?: {
                actorId?: string;
                actions?: string;
                workspaceId?: string;
                targetId?: string;
                from?: string;
                to?: string;
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "text/csv": string;
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    SearchController_find: {
        parameters: {
            query: {
                q: string;
                workspaceId?: string;
                section?: "DOCS" | "VIDEOS";
                type?: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                tagIds?: string;
                createdBy?: string;
                from?: string;
                to?: string;
                cursor?: string;
                limit?: number;
            };
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        items: {
                            node: {
                                id: string;
                                workspaceId: string;
                                parentId: string | null;
                                type: "FOLDER" | "DOCUMENT" | "FILE" | "VIDEO";
                                name: string;
                                description: string | null;
                                status: "UPLOADING" | "PROCESSING" | "READY" | "FAILED";
                                createdBy: {
                                    id: string;
                                    email: string;
                                    name: string;
                                    avatarUrl: string | null;
                                };
                                createdAt: string;
                                updatedAt: string;
                                myRole: "VIEWER" | "EDITOR" | "OWNER";
                                section: "DOCS" | "VIDEOS";
                                isFavorite: boolean;
                                tags: {
                                    id: string;
                                    name: string;
                                    color: string;
                                }[];
                                childCount: number | null;
                                size: number | null;
                                mime: string | null;
                                documentFormat: "RICH" | "LATEX" | null;
                            };
                            workspace: {
                                id: string;
                                name: string;
                            };
                            path: string[];
                            name: {
                                text: string;
                                match: boolean;
                            }[];
                            snippet: {
                                text: string;
                                match: boolean;
                            }[] | null;
                            matchedIn: "name" | "content" | "tags";
                        }[];
                        total: number;
                        nextCursor: string | null;
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    SearchController_reindex: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        queued: boolean;
                    };
                };
            };
            401: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            403: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
    DevAuthController_token: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": {
                    email: string;
                    name?: string;
                };
            };
        };
        responses: {
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        accessToken: string;
                        tokenType: "Bearer";
                        expiresIn: number;
                        user: {
                            id: string;
                            email: string;
                            name: string;
                            avatarUrl: string | null;
                            isSystemAdmin: boolean;
                        };
                    };
                };
            };
            400: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
            429: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Error"];
                };
            };
        };
    };
}
