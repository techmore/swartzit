-- SQLite baseline corresponding to PostgreSQL migrations through 0056.
-- PostgreSQL history remains in migrations/ for the one-time importer.
-- All durable application tables retain their IDs and relationships.

CREATE TABLE adsense_settings (
    singleton INTEGER DEFAULT true NOT NULL,
    publisher_id TEXT,
    updated_by INTEGER,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT adsense_settings_singleton_check CHECK (singleton),
    CONSTRAINT adsense_settings_pkey PRIMARY KEY (singleton),
    CONSTRAINT adsense_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES authors(id) ON DELETE SET NULL,
    CHECK (singleton IS NULL OR singleton IN (0,1))
);

CREATE TABLE author_like_privacy (
    author_id INTEGER NOT NULL,
    visibility TEXT DEFAULT 'followers' NOT NULL,
    non_rated_only INTEGER DEFAULT true NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    non_rated_only_configured INTEGER DEFAULT false NOT NULL,
    CONSTRAINT author_like_privacy_visibility_check CHECK ((visibility IN ('followers', 'selected', 'hidden'))),
    CONSTRAINT author_like_privacy_pkey PRIMARY KEY (author_id),
    CONSTRAINT author_like_privacy_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CHECK (non_rated_only IS NULL OR non_rated_only IN (0,1)),
    CHECK (non_rated_only_configured IS NULL OR non_rated_only_configured IN (0,1))
);

CREATE TABLE author_like_share_recipients (
    author_id INTEGER NOT NULL,
    recipient_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT author_like_share_recipients_not_self CHECK ((author_id <> recipient_id)),
    CONSTRAINT author_like_share_recipients_pkey PRIMARY KEY (author_id, recipient_id),
    CONSTRAINT author_like_share_recipients_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT author_like_share_recipients_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE author_pinned_posts (
    author_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    pinned_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT author_pinned_posts_pkey PRIMARY KEY (author_id),
    CONSTRAINT author_pinned_posts_post_id_key UNIQUE (post_id),
    CONSTRAINT author_pinned_posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT author_pinned_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE author_post_preferences (
    author_id INTEGER NOT NULL,
    copy_link_after_post INTEGER DEFAULT true NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT author_post_preferences_pkey PRIMARY KEY (author_id),
    CONSTRAINT author_post_preferences_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CHECK (copy_link_after_post IS NULL OR copy_link_after_post IN (0,1))
);

CREATE TABLE author_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    url TEXT,
    favicon_url TEXT,
    github_url TEXT,
    sort_order INTEGER DEFAULT 0 NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT author_projects_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
    CONSTRAINT author_projects_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    handle TEXT NOT NULL,
    password_hash TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    is_admin INTEGER DEFAULT false NOT NULL,
    display_name TEXT DEFAULT '' NOT NULL,
    bio TEXT DEFAULT '' NOT NULL,
    avatar_url TEXT,
    profile_updated_at TEXT,
    suspended_until TEXT,
    suspension_reason TEXT DEFAULT '' NOT NULL,
    CONSTRAINT authors_handle_key UNIQUE (handle),
    CHECK (is_admin IS NULL OR is_admin IN (0,1))
);

CREATE TABLE bookmark_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    parent_id INTEGER,
    CONSTRAINT bookmark_folders_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
    CONSTRAINT bookmark_folders_author_id_id_key UNIQUE (author_id, id),
    CONSTRAINT bookmark_folder_parent_fk FOREIGN KEY (author_id, parent_id) REFERENCES bookmark_folders(author_id, id),
    CONSTRAINT bookmark_folders_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE bookmarks (
    author_id INTEGER NOT NULL,
    post_id INTEGER NOT NULL,
    folder_id INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT bookmarks_pkey PRIMARY KEY (author_id, post_id),
    CONSTRAINT bookmarks_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT bookmarks_author_id_folder_id_fkey FOREIGN KEY (author_id, folder_id) REFERENCES bookmark_folders(author_id, id),
    CONSTRAINT bookmarks_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE buddy_follows (
    follower_id INTEGER NOT NULL,
    followed_id INTEGER NOT NULL,
    pinned INTEGER DEFAULT false NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT buddy_follows_not_self CHECK ((follower_id <> followed_id)),
    CONSTRAINT buddy_follows_pkey PRIMARY KEY (follower_id, followed_id),
    CONSTRAINT buddy_follows_followed_id_fkey FOREIGN KEY (followed_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT buddy_follows_follower_id_fkey FOREIGN KEY (follower_id) REFERENCES authors(id) ON DELETE CASCADE,
    CHECK (pinned IS NULL OR pinned IN (0,1))
);

CREATE TABLE comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    parent_id INTEGER,
    body TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    moderation_status TEXT DEFAULT 'pending' NOT NULL,
    moderation_item_id INTEGER,
    moderation_reviewed_by INTEGER,
    moderation_reviewed_at TEXT,
    source TEXT,
    CONSTRAINT comments_body_check CHECK ((((source IS NOT NULL) AND ((length(body) >= 0) AND (length(body) <= 10000))) OR ((source IS NULL) AND ((length(body) >= 1) AND (length(body) <= 10000))))),
    CONSTRAINT comments_check CHECK (((parent_id IS NULL) OR (parent_id < id))),
    CONSTRAINT comments_moderation_status_check CHECK ((moderation_status IN ('pending', 'approved', 'rejected', 'escalated'))),
    CONSTRAINT comments_source_object_check CHECK (((source IS NULL) OR (json_type(source) = 'object'))),
    CONSTRAINT comments_post_id_id_key UNIQUE (post_id, id),
    CONSTRAINT comments_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id),
    CONSTRAINT comments_moderation_item_id_fkey FOREIGN KEY (moderation_item_id) REFERENCES moderation_items(id) ON DELETE SET NULL,
    CONSTRAINT comments_moderation_reviewed_by_fkey FOREIGN KEY (moderation_reviewed_by) REFERENCES authors(id) ON DELETE SET NULL,
    CONSTRAINT comments_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id),
    CONSTRAINT comments_post_id_parent_id_fkey FOREIGN KEY (post_id, parent_id) REFERENCES comments(post_id, id),
    CHECK (source IS NULL OR json_valid(source))
);

CREATE TABLE communities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '' NOT NULL,
    CONSTRAINT communities_slug_check CHECK ((length(slug) BETWEEN 1 AND 40 AND slug NOT GLOB '*[^a-z0-9_]*')),
    CONSTRAINT communities_slug_key UNIQUE (slug)
);

CREATE TABLE community_subscriptions (
    community_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT community_subscriptions_pkey PRIMARY KEY (community_id, author_id),
    CONSTRAINT community_subscriptions_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT community_subscriptions_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE CASCADE
);

CREATE TABLE content_runner_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    runner_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    finished_at TEXT,
    post_id INTEGER,
    error TEXT,
    detail TEXT DEFAULT '{}' NOT NULL,
    attempt INTEGER DEFAULT 1 NOT NULL,
    config_version INTEGER DEFAULT 1 NOT NULL,
    exit_code INTEGER,
    duration_ms INTEGER,
    timed_out INTEGER DEFAULT false NOT NULL,
    stdout TEXT DEFAULT '' NOT NULL,
    stderr TEXT DEFAULT '' NOT NULL,
    retry_at TEXT,
    requested_by INTEGER,
    dry_run INTEGER DEFAULT false NOT NULL,
    progress_percent INTEGER,
    progress_phase TEXT,
    progress_message TEXT,
    current_step INTEGER,
    total_steps INTEGER,
    eta_seconds INTEGER,
    progress_updated_at TEXT,
    control_request TEXT,
    CONSTRAINT content_runner_runs_attempt_check CHECK ((attempt >= 1)),
    CONSTRAINT content_runner_runs_control_request_check CHECK (((control_request IS NULL) OR (control_request IN ('pause', 'cancel')))),
    CONSTRAINT content_runner_runs_output_check CHECK (((length(stdout) <= 20000) AND (length(stderr) <= 20000))),
    CONSTRAINT content_runner_runs_progress_eta_check CHECK (((eta_seconds IS NULL) OR (eta_seconds >= 0))),
    CONSTRAINT content_runner_runs_progress_percent_check CHECK (((progress_percent IS NULL) OR ((progress_percent >= 0) AND (progress_percent <= 100)))),
    CONSTRAINT content_runner_runs_progress_step_check CHECK (((current_step IS NULL) OR (current_step >= 0))),
    CONSTRAINT content_runner_runs_progress_total_step_check CHECK (((total_steps IS NULL) OR (total_steps >= 0))),
    CONSTRAINT content_runner_runs_status_check CHECK ((status IN ('running', 'success', 'failed', 'timeout', 'skipped', 'cancelled', 'paused'))),
    CONSTRAINT content_runner_runs_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE SET NULL,
    CONSTRAINT content_runner_runs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES authors(id) ON DELETE SET NULL,
    CONSTRAINT content_runner_runs_runner_id_fkey FOREIGN KEY (runner_id) REFERENCES content_runners(id) ON DELETE CASCADE,
    CHECK (detail IS NULL OR json_valid(detail)),
    CHECK (timed_out IS NULL OR timed_out IN (0,1)),
    CHECK (dry_run IS NULL OR dry_run IN (0,1))
);

CREATE TABLE content_runners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    command TEXT DEFAULT '[]' NOT NULL,
    prompt TEXT DEFAULT '' NOT NULL,
    author_id INTEGER NOT NULL,
    community_id INTEGER NOT NULL,
    interval_seconds INTEGER NOT NULL,
    priority INTEGER DEFAULT 100 NOT NULL,
    enabled INTEGER DEFAULT false NOT NULL,
    next_run_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    last_run_at TEXT,
    last_status TEXT,
    last_error TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    state TEXT DEFAULT 'draft' NOT NULL,
    timeout_seconds INTEGER DEFAULT 900 NOT NULL,
    max_attempts INTEGER DEFAULT 3 NOT NULL,
    retry_backoff_seconds INTEGER DEFAULT 60 NOT NULL,
    failure_threshold INTEGER DEFAULT 3 NOT NULL,
    consecutive_failures INTEGER DEFAULT 0 NOT NULL,
    current_attempt INTEGER DEFAULT 0 NOT NULL,
    retention_days INTEGER DEFAULT 30 NOT NULL,
    paused_reason TEXT,
    archived_at TEXT,
    last_success_at TEXT,
    config_version INTEGER DEFAULT 1 NOT NULL,
    updated_by INTEGER,
    environment_keys TEXT DEFAULT '[]' NOT NULL,
    capture_output INTEGER DEFAULT true NOT NULL,
    max_log_bytes INTEGER DEFAULT 20000 NOT NULL,
    days_of_week TEXT DEFAULT '[1, 2, 3, 4, 5, 6, 7]' NOT NULL,
    test_requested INTEGER DEFAULT false NOT NULL,
    CONSTRAINT content_runners_attempts_check CHECK (((max_attempts >= 1) AND (max_attempts <= 10))),
    CONSTRAINT content_runners_backoff_check CHECK (((retry_backoff_seconds >= 10) AND (retry_backoff_seconds <= 86400))),
    CONSTRAINT content_runners_command_check CHECK ((((kind = 'draw_things') AND (json_type(command) = 'object')) OR ((kind = 'content_package') AND (json_type(command) = 'object')) OR ((kind IN ('command', 'cross_post')) AND (json_type(command) = 'array')))),
    CONSTRAINT content_runners_config_version_check CHECK ((config_version >= 1)),
    CONSTRAINT content_runners_consecutive_failures_check CHECK ((consecutive_failures >= 0)),
    CONSTRAINT content_runners_current_attempt_check CHECK ((current_attempt >= 0)),
    CONSTRAINT content_runners_days_of_week_check CHECK ((json_type(days_of_week) = 'array')),
    CONSTRAINT content_runners_environment_keys_check CHECK ((json_type(environment_keys) = 'array')),
    CONSTRAINT content_runners_failure_threshold_check CHECK (((failure_threshold >= 1) AND (failure_threshold <= 100))),
    CONSTRAINT content_runners_interval_seconds_check CHECK (((interval_seconds >= 60) AND (interval_seconds <= 604800))),
    CONSTRAINT content_runners_kind_check CHECK ((kind IN ('command', 'cross_post', 'draw_things', 'content_package'))),
    CONSTRAINT content_runners_log_bytes_check CHECK (((max_log_bytes >= 1024) AND (max_log_bytes <= 20000))),
    CONSTRAINT content_runners_name_check CHECK (((length(name) >= 1) AND (length(name) <= 80))),
    CONSTRAINT content_runners_priority_check CHECK (((priority >= 0) AND (priority <= 10000))),
    CONSTRAINT content_runners_prompt_check CHECK ((length(prompt) <= 20000)),
    CONSTRAINT content_runners_retention_check CHECK (((retention_days >= 1) AND (retention_days <= 3650))),
    CONSTRAINT content_runners_state_check CHECK ((state IN ('draft', 'enabled', 'paused', 'retrying', 'archived'))),
    CONSTRAINT content_runners_timeout_check CHECK (((timeout_seconds >= 30) AND (timeout_seconds <= 86400))),
    CONSTRAINT content_runners_name_key UNIQUE (name),
    CONSTRAINT content_runners_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id),
    CONSTRAINT content_runners_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id),
    CONSTRAINT content_runners_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES authors(id) ON DELETE SET NULL,
    CHECK (command IS NULL OR json_valid(command)),
    CHECK (enabled IS NULL OR enabled IN (0,1)),
    CHECK (environment_keys IS NULL OR json_valid(environment_keys)),
    CHECK (capture_output IS NULL OR capture_output IN (0,1)),
    CHECK (days_of_week IS NULL OR json_valid(days_of_week)),
    CHECK (test_requested IS NULL OR test_requested IN (0,1))
);

CREATE TABLE crawler_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    source TEXT NOT NULL,
    community_id INTEGER,
    interval_seconds INTEGER NOT NULL,
    max_items INTEGER NOT NULL,
    mode TEXT DEFAULT 'review' NOT NULL,
    filters TEXT DEFAULT '{}' NOT NULL,
    enabled INTEGER DEFAULT true NOT NULL,
    next_run_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    last_run_at TEXT,
    last_status TEXT DEFAULT 'never_run' NOT NULL,
    last_error TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT crawler_jobs_interval_seconds_check CHECK (((interval_seconds >= 300) AND (interval_seconds <= 604800))),
    CONSTRAINT crawler_jobs_max_items_check CHECK (((max_items >= 1) AND (max_items <= 100))),
    CONSTRAINT crawler_jobs_mode_check CHECK ((mode IN ('review', 'automatic'))),
    CONSTRAINT crawler_jobs_provider_check CHECK ((provider IN ('x', 'reddit', 'rss', 'commons'))),
    CONSTRAINT crawler_jobs_name_key UNIQUE (name),
    CONSTRAINT crawler_jobs_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id) ON DELETE SET NULL,
    CHECK (filters IS NULL OR json_valid(filters)),
    CHECK (enabled IS NULL OR enabled IN (0,1))
);

CREATE TABLE crawler_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    imported_count INTEGER DEFAULT 0 NOT NULL,
    error TEXT,
    detail TEXT DEFAULT '{}' NOT NULL,
    CONSTRAINT crawler_runs_status_check CHECK ((status IN ('queued', 'running', 'success', 'failed', 'skipped'))),
    CONSTRAINT crawler_runs_job_id_fkey FOREIGN KEY (job_id) REFERENCES crawler_jobs(id) ON DELETE CASCADE,
    CHECK (detail IS NULL OR json_valid(detail))
);

CREATE TABLE draw_things_feedback (
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    overall INTEGER NOT NULL,
    prompt_match INTEGER,
    natural_color INTEGER,
    realism INTEGER,
    likeness INTEGER,
    composition INTEGER,
    detail INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT draw_things_feedback_composition_check CHECK (((composition IS NULL) OR ((composition >= 1) AND (composition <= 5)))),
    CONSTRAINT draw_things_feedback_detail_check CHECK (((detail IS NULL) OR ((detail >= 1) AND (detail <= 5)))),
    CONSTRAINT draw_things_feedback_likeness_check CHECK (((likeness IS NULL) OR ((likeness >= 1) AND (likeness <= 5)))),
    CONSTRAINT draw_things_feedback_natural_color_check CHECK (((natural_color IS NULL) OR ((natural_color >= 1) AND (natural_color <= 5)))),
    CONSTRAINT draw_things_feedback_overall_check CHECK (((overall >= 1) AND (overall <= 5))),
    CONSTRAINT draw_things_feedback_prompt_match_check CHECK (((prompt_match IS NULL) OR ((prompt_match >= 1) AND (prompt_match <= 5)))),
    CONSTRAINT draw_things_feedback_realism_check CHECK (((realism IS NULL) OR ((realism >= 1) AND (realism <= 5)))),
    CONSTRAINT draw_things_feedback_pkey PRIMARY KEY (post_id, author_id),
    CONSTRAINT draw_things_feedback_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT draw_things_feedback_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE external_posts (
    post_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_author TEXT NOT NULL,
    published_at TEXT,
    observed_at TEXT NOT NULL,
    source_views INTEGER,
    source_likes INTEGER,
    source_reposts INTEGER,
    source_replies INTEGER,
    media TEXT DEFAULT '[]' NOT NULL,
    attribution TEXT DEFAULT '' NOT NULL,
    profile_image_url TEXT,
    profile_image_cached_at TEXT,
    profile_url TEXT,
    profile_display_name TEXT,
    profile_bio TEXT,
    profile_followers INTEGER,
    profile_following INTEGER,
    profile_verified INTEGER,
    source_comments TEXT DEFAULT '[]' NOT NULL,
    generation_config TEXT DEFAULT '{}' NOT NULL,
    CONSTRAINT external_posts_generation_config_object_check CHECK ((json_type(generation_config) = 'object')),
    CONSTRAINT external_posts_provider_check CHECK ((provider IN ('x', 'reddit', 'rss', 'commons', 'runner', 'youtube'))),
    CONSTRAINT external_posts_source_comments_array_check CHECK ((json_type(source_comments) = 'array')),
    CONSTRAINT external_posts_source_likes_check CHECK ((source_likes >= 0)),
    CONSTRAINT external_posts_source_replies_check CHECK ((source_replies >= 0)),
    CONSTRAINT external_posts_source_reposts_check CHECK ((source_reposts >= 0)),
    CONSTRAINT external_posts_source_views_check CHECK ((source_views >= 0)),
    CONSTRAINT external_posts_pkey PRIMARY KEY (post_id),
    CONSTRAINT external_posts_source_url_key UNIQUE (source_url),
    CONSTRAINT external_posts_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CHECK (media IS NULL OR json_valid(media)),
    CHECK (profile_verified IS NULL OR profile_verified IN (0,1)),
    CHECK (source_comments IS NULL OR json_valid(source_comments)),
    CHECK (generation_config IS NULL OR json_valid(generation_config))
);

CREATE TABLE instance_modules (
    module_key TEXT NOT NULL,
    enabled INTEGER DEFAULT true NOT NULL,
    updated_by INTEGER,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT instance_modules_pkey PRIMARY KEY (module_key),
    CONSTRAINT instance_modules_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES authors(id) ON DELETE SET NULL,
    CHECK (enabled IS NULL OR enabled IN (0,1))
);

CREATE TABLE ip_activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    route TEXT NOT NULL,
    method TEXT NOT NULL,
    status INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    slot INTEGER GENERATED ALWAYS AS ((id % (5000))) STORED
);

CREATE TABLE ip_blocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    label TEXT DEFAULT '' NOT NULL,
    reason TEXT DEFAULT '' NOT NULL,
    expires_at TEXT,
    created_by INTEGER,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT ip_blocks_ip_hash_key UNIQUE (ip_hash),
    CONSTRAINT ip_blocks_created_by_fkey FOREIGN KEY (created_by) REFERENCES authors(id) ON DELETE SET NULL
);

CREATE TABLE media_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    content_hash TEXT NOT NULL,
    media_type TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    magnet_uri TEXT,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    content_bytes BLOB,
    content_type TEXT DEFAULT 'application/octet-stream' NOT NULL,
    storage_backend TEXT DEFAULT 'legacy' NOT NULL,
    object_key TEXT,
    mime_type TEXT,
    status TEXT DEFAULT 'ready' NOT NULL,
    visibility TEXT DEFAULT 'public' NOT NULL,
    variants TEXT DEFAULT '{}' NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT media_assets_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT media_assets_content_bytes_size_check CHECK (((content_bytes IS NULL) OR (length(content_bytes) <= 5242880))),
    CONSTRAINT media_assets_media_type_check CHECK ((media_type IN ('image', 'video', 'audio', 'file'))),
    CONSTRAINT media_assets_status_check CHECK ((status IN ('uploading', 'ready', 'failed', 'quarantined', 'deleted'))),
    CONSTRAINT media_assets_storage_backend_check CHECK ((storage_backend IN ('legacy', 'filesystem', 's3', 'ipfs'))),
    CONSTRAINT media_assets_variants_object_check CHECK ((json_type(variants) = 'object')),
    CONSTRAINT media_assets_visibility_check CHECK ((visibility IN ('public', 'private'))),
    CONSTRAINT media_assets_content_hash_key UNIQUE (content_hash),
    CHECK (variants IS NULL OR json_valid(variants))
);

CREATE TABLE media_replicas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    role TEXT NOT NULL,
    variant TEXT DEFAULT 'original' NOT NULL,
    object_key TEXT,
    external_url TEXT,
    external_id TEXT,
    checksum TEXT,
    byte_size INTEGER DEFAULT 0 NOT NULL,
    mime_type TEXT DEFAULT 'application/octet-stream' NOT NULL,
    state TEXT DEFAULT 'ready' NOT NULL,
    error TEXT DEFAULT '' NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    last_verified_at TEXT,
    CONSTRAINT media_replicas_byte_size_check CHECK ((byte_size >= 0)),
    CONSTRAINT media_replicas_provider_check CHECK ((provider IN ('legacy_db', 'filesystem', 's3', 'ipfs', 'catbox'))),
    CONSTRAINT media_replicas_role_check CHECK ((role IN ('primary', 'secondary', 'cache', 'backup', 'share'))),
    CONSTRAINT media_replicas_state_check CHECK ((state IN ('uploading', 'ready', 'failed', 'deleted'))),
    CONSTRAINT media_replicas_media_id_provider_role_variant_key UNIQUE (media_id, provider, role, variant),
    CONSTRAINT media_replicas_media_id_fkey FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE TABLE media_replication_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_id INTEGER NOT NULL,
    provider TEXT NOT NULL,
    variant TEXT NOT NULL,
    status TEXT DEFAULT 'pending' NOT NULL,
    attempts INTEGER DEFAULT 0 NOT NULL,
    available_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    locked_at TEXT,
    last_error TEXT DEFAULT '' NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    completed_at TEXT,
    CONSTRAINT media_replication_jobs_attempts_check CHECK ((attempts >= 0)),
    CONSTRAINT media_replication_jobs_provider_check CHECK ((provider IN ('filesystem', 's3', 'ipfs'))),
    CONSTRAINT media_replication_jobs_status_check CHECK ((status IN ('pending', 'running', 'ready', 'failed'))),
    CONSTRAINT media_replication_jobs_media_id_provider_variant_key UNIQUE (media_id, provider, variant),
    CONSTRAINT media_replication_jobs_media_id_fkey FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE CASCADE
);

CREATE TABLE media_settings (
    singleton INTEGER DEFAULT true NOT NULL,
    primary_provider TEXT DEFAULT 'filesystem' NOT NULL,
    cache_enabled INTEGER DEFAULT true NOT NULL,
    cache_max_bytes INTEGER DEFAULT '5368709120' NOT NULL,
    share_provider TEXT DEFAULT 'disabled' NOT NULL,
    updated_by INTEGER,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    secondary_provider TEXT DEFAULT 'disabled' NOT NULL,
    secondary_providers TEXT DEFAULT '[]' NOT NULL,
    CONSTRAINT media_settings_cache_max_bytes_check CHECK (((cache_max_bytes >= 1048576) AND (cache_max_bytes <= '1099511627776'))),
    CONSTRAINT media_settings_distinct_providers_check CHECK (((secondary_provider = 'disabled') OR (secondary_provider <> primary_provider))),
    CONSTRAINT media_settings_primary_provider_check CHECK ((primary_provider IN ('filesystem', 's3', 'ipfs'))),
    CONSTRAINT media_settings_secondary_provider_check CHECK ((secondary_provider IN ('disabled', 'filesystem', 's3', 'ipfs'))),
    CONSTRAINT media_settings_share_provider_check CHECK ((share_provider IN ('disabled', 'catbox'))),
    CONSTRAINT media_settings_singleton_check CHECK (singleton),
    CONSTRAINT media_settings_pkey PRIMARY KEY (singleton),
    CONSTRAINT media_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES authors(id) ON DELETE SET NULL,
    CHECK (singleton IS NULL OR singleton IN (0,1)),
    CHECK (cache_enabled IS NULL OR cache_enabled IN (0,1)),
    CHECK (secondary_providers IS NULL OR json_valid(secondary_providers))
);

CREATE TABLE moderation_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    moderation_item_id INTEGER NOT NULL,
    actor_id INTEGER NOT NULL,
    action TEXT NOT NULL,
    from_status TEXT NOT NULL,
    to_status TEXT NOT NULL,
    note TEXT DEFAULT '' NOT NULL,
    detail TEXT DEFAULT '{}' NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT moderation_actions_action_check CHECK ((action IN ('approve', 'reject', 'dismiss', 'suspend', 'escalate'))),
    CONSTRAINT moderation_actions_actor_id_fkey FOREIGN KEY (actor_id) REFERENCES authors(id) ON DELETE RESTRICT,
    CONSTRAINT moderation_actions_moderation_item_id_fkey FOREIGN KEY (moderation_item_id) REFERENCES moderation_items(id) ON DELETE CASCADE,
    CHECK (detail IS NULL OR json_valid(detail))
);

CREATE TABLE moderation_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kind TEXT NOT NULL,
    target_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    severity TEXT DEFAULT 'none' NOT NULL,
    flags TEXT DEFAULT '[]' NOT NULL,
    rule_version TEXT NOT NULL,
    payload TEXT DEFAULT '{}' NOT NULL,
    urgent INTEGER DEFAULT false NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    reviewed_by INTEGER,
    reviewed_at TEXT,
    review_note TEXT DEFAULT '' NOT NULL,
    CONSTRAINT moderation_items_kind_check CHECK ((kind IN ('post', 'comment', 'profile'))),
    CONSTRAINT moderation_items_severity_check CHECK ((severity IN ('none', 'low', 'medium', 'high'))),
    CONSTRAINT moderation_items_status_check CHECK ((status IN ('pending', 'approved', 'rejected', 'dismissed', 'escalated'))),
    CONSTRAINT moderation_items_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT moderation_items_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES authors(id) ON DELETE SET NULL,
    CHECK (flags IS NULL OR json_valid(flags)),
    CHECK (payload IS NULL OR json_valid(payload)),
    CHECK (urgent IS NULL OR urgent IN (0,1))
);

CREATE TABLE post_media (
    post_id INTEGER NOT NULL,
    media_id INTEGER NOT NULL,
    "position" INTEGER DEFAULT 0 NOT NULL,
    CONSTRAINT post_media_position_check CHECK (("position" >= 0)),
    CONSTRAINT post_media_pkey PRIMARY KEY (post_id, media_id),
    CONSTRAINT post_media_media_id_fkey FOREIGN KEY (media_id) REFERENCES media_assets(id) ON DELETE RESTRICT,
    CONSTRAINT post_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE post_stats (
    post_id INTEGER NOT NULL,
    comment_count INTEGER DEFAULT 0 NOT NULL,
    score INTEGER DEFAULT 0 NOT NULL,
    view_count INTEGER DEFAULT 0 NOT NULL,
    engaged_view_count INTEGER DEFAULT 0 NOT NULL,
    deep_view_count INTEGER DEFAULT 0 NOT NULL,
    updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT post_stats_pkey PRIMARY KEY (post_id),
    CONSTRAINT post_stats_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE post_view_visits (
    post_id INTEGER NOT NULL,
    visit_hash BLOB NOT NULL,
    seconds INTEGER DEFAULT 0 NOT NULL,
    started_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT post_view_visits_pkey PRIMARY KEY (post_id, visit_hash),
    CONSTRAINT post_view_visits_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE post_votes (
    post_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    value INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT post_votes_value_check CHECK ((value IN ('-1', 1))),
    CONSTRAINT post_votes_pkey PRIMARY KEY (post_id, author_id),
    CONSTRAINT post_votes_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT post_votes_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
);

CREATE TABLE posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    community_id INTEGER NOT NULL,
    author_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT DEFAULT '' NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    view_count INTEGER DEFAULT 0 NOT NULL,
    engaged_view_count INTEGER DEFAULT 0 NOT NULL,
    deep_view_count INTEGER DEFAULT 0 NOT NULL,
    public_id TEXT DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
    moderation_status TEXT DEFAULT 'pending' NOT NULL,
    moderation_item_id INTEGER,
    moderation_reviewed_by INTEGER,
    moderation_reviewed_at TEXT,
    content_rating TEXT DEFAULT 'general' NOT NULL,
    content_rating_source TEXT DEFAULT 'legacy' NOT NULL,
    content_rating_confidence REAL,
    content_rating_updated_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT posts_content_rating_check CHECK ((content_rating IN ('general', 'r', 'x'))),
    CONSTRAINT posts_content_rating_confidence_check CHECK (((content_rating_confidence IS NULL) OR ((content_rating_confidence >= (0)) AND (content_rating_confidence <= (1))))),
    CONSTRAINT posts_content_rating_source_check CHECK ((content_rating_source IN ('legacy', 'uploader', 'automatic', 'moderator'))),
    CONSTRAINT posts_moderation_status_check CHECK ((moderation_status IN ('pending', 'approved', 'rejected', 'escalated'))),
    CONSTRAINT posts_title_check CHECK (((length(title) >= 1) AND (length(title) <= 300))),
    CONSTRAINT posts_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id),
    CONSTRAINT posts_community_id_fkey FOREIGN KEY (community_id) REFERENCES communities(id),
    CONSTRAINT posts_moderation_item_id_fkey FOREIGN KEY (moderation_item_id) REFERENCES moderation_items(id) ON DELETE SET NULL,
    CONSTRAINT posts_moderation_reviewed_by_fkey FOREIGN KEY (moderation_reviewed_by) REFERENCES authors(id) ON DELETE SET NULL
);

CREATE TABLE reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reporter_id INTEGER NOT NULL,
    post_id INTEGER,
    comment_id INTEGER,
    reason TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    resolved_at TEXT,
    resolved_by INTEGER,
    CONSTRAINT reports_check CHECK (((post_id IS NOT NULL) <> (comment_id IS NOT NULL))),
    CONSTRAINT reports_reason_check CHECK (((length(reason) >= 1) AND (length(reason) <= 1000))),
    CONSTRAINT reports_comment_id_fkey FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    CONSTRAINT reports_post_id_fkey FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    CONSTRAINT reports_reporter_id_fkey FOREIGN KEY (reporter_id) REFERENCES authors(id) ON DELETE CASCADE,
    CONSTRAINT reports_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES authors(id)
);

CREATE TABLE sessions (
    token_hash BLOB NOT NULL,
    author_id INTEGER NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    expires_at TEXT NOT NULL,
    CONSTRAINT sessions_pkey PRIMARY KEY (token_hash),
    CONSTRAINT sessions_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE TABLE system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL,
    event TEXT NOT NULL,
    detail TEXT DEFAULT '{}' NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    slot INTEGER GENERATED ALWAYS AS ((id % (1000))) STORED,
    CONSTRAINT system_logs_level_check CHECK ((level IN ('info', 'warn', 'error'))),
    CONSTRAINT system_logs_slot_key UNIQUE (slot),
    CHECK (detail IS NULL OR json_valid(detail))
);

CREATE TABLE x_author_subscriptions (
    author_id INTEGER NOT NULL,
    handle TEXT NOT NULL,
    created_at TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
    CONSTRAINT x_author_subscriptions_handle_check CHECK ((length(handle) BETWEEN 1 AND 15 AND handle NOT GLOB '*[^a-z0-9_]*')),
    CONSTRAINT x_author_subscriptions_pkey PRIMARY KEY (author_id, handle),
    CONSTRAINT x_author_subscriptions_author_id_fkey FOREIGN KEY (author_id) REFERENCES authors(id) ON DELETE CASCADE
);

CREATE INDEX author_projects_profile_order ON author_projects (author_id, sort_order, id);

CREATE UNIQUE INDEX bookmark_folder_child_names ON bookmark_folders (author_id, parent_id, lower(name)) WHERE (parent_id IS NOT NULL);

CREATE INDEX bookmark_folder_parent ON bookmark_folders (author_id, parent_id, lower(name));

CREATE UNIQUE INDEX bookmark_folder_root_names ON bookmark_folders (author_id, lower(name)) WHERE (parent_id IS NULL);

CREATE INDEX bookmarks_saved ON bookmarks (author_id, created_at DESC, post_id DESC);

CREATE INDEX buddy_follows_followed_idx ON buddy_follows (followed_id, follower_id);

CREATE INDEX buddy_follows_pinned_idx ON buddy_follows (follower_id, followed_id) WHERE pinned;

CREATE INDEX comments_approved_author_feed_idx ON comments (author_id, created_at DESC, id DESC) WHERE (moderation_status = 'approved');

CREATE INDEX comments_moderation_idx ON comments (moderation_status, created_at DESC, id DESC);

CREATE INDEX comments_post_idx ON comments (post_id, created_at, id);

CREATE INDEX community_subscriptions_author_idx ON community_subscriptions (author_id, community_id);

CREATE INDEX content_runner_runs_control_idx ON content_runner_runs (status, control_request) WHERE ((status = 'running') AND (control_request IS NOT NULL));

CREATE INDEX content_runner_runs_recent_idx ON content_runner_runs (runner_id, started_at DESC);

CREATE INDEX content_runner_runs_runner_idx ON content_runner_runs (runner_id, id DESC);

CREATE INDEX content_runners_due_idx ON content_runners (enabled, next_run_at, priority, id);

CREATE INDEX content_runners_test_idx ON content_runners (test_requested, priority, id) WHERE test_requested;

CREATE INDEX crawler_jobs_due_idx ON crawler_jobs (enabled, next_run_at);

CREATE INDEX crawler_runs_job_idx ON crawler_runs (job_id, started_at DESC);

CREATE INDEX draw_things_feedback_post_idx ON draw_things_feedback (post_id, updated_at DESC);

CREATE INDEX external_posts_profile_image_idx ON external_posts (profile_image_cached_at) WHERE (profile_image_url IS NOT NULL);

CREATE INDEX ip_activity_recent_idx ON ip_activity (created_at DESC);

CREATE UNIQUE INDEX ip_activity_slot_unique ON ip_activity (slot);

CREATE INDEX media_replicas_media_idx ON media_replicas (media_id, variant, role);

CREATE INDEX media_replicas_verification_idx ON media_replicas (state, last_verified_at);

CREATE INDEX media_replication_jobs_claim_idx ON media_replication_jobs (status, available_at, id);

CREATE INDEX media_replication_jobs_media_idx ON media_replication_jobs (media_id, provider, variant);

CREATE INDEX moderation_actions_item_idx ON moderation_actions (moderation_item_id, created_at DESC);

CREATE INDEX moderation_author_idx ON moderation_items (author_id, created_at DESC);

CREATE UNIQUE INDEX moderation_profile_pending_idx ON moderation_items (kind, target_id) WHERE ((kind = 'profile') AND (status IN ('pending', 'escalated')));

CREATE INDEX moderation_queue_idx ON moderation_items (status, urgent DESC, created_at);

CREATE INDEX post_view_visits_expiry ON post_view_visits (started_at);

CREATE INDEX post_votes_buddy_feed_idx ON post_votes (author_id, created_at DESC, post_id) WHERE (value = 1);

CREATE INDEX posts_approved_community_feed_idx ON posts (community_id, created_at DESC, id DESC) WHERE (moderation_status = 'approved');

CREATE INDEX posts_approved_feed_idx ON posts (created_at DESC, id DESC) WHERE (moderation_status = 'approved');

CREATE INDEX posts_community_idx ON posts (community_id, created_at DESC, id DESC);

CREATE INDEX posts_content_rating_idx ON posts (content_rating, moderation_status, created_at DESC, id DESC);

CREATE INDEX posts_moderation_idx ON posts (moderation_status, created_at DESC, id DESC);

CREATE INDEX posts_new_idx ON posts (created_at DESC, id DESC);

CREATE UNIQUE INDEX posts_public_id_idx ON posts (public_id);

CREATE INDEX reports_open_idx ON reports (created_at DESC);

CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE INDEX system_logs_created_idx ON system_logs (created_at DESC, id DESC);

CREATE INDEX x_author_subscriptions_handle_author_idx ON x_author_subscriptions (handle, author_id);

CREATE VIRTUAL TABLE posts_fts USING fts5(title, body, content='posts', content_rowid='id', tokenize='porter unicode61');
CREATE TRIGGER posts_fts_insert AFTER INSERT ON posts BEGIN
  INSERT INTO posts_fts(rowid,title,body) VALUES(new.id,new.title,new.body);
END;
CREATE TRIGGER posts_fts_delete AFTER DELETE ON posts BEGIN
  INSERT INTO posts_fts(posts_fts,rowid,title,body) VALUES('delete',old.id,old.title,old.body);
END;
CREATE TRIGGER posts_fts_update AFTER UPDATE OF title,body ON posts BEGIN
  INSERT INTO posts_fts(posts_fts,rowid,title,body) VALUES('delete',old.id,old.title,old.body);
  INSERT INTO posts_fts(rowid,title,body) VALUES(new.id,new.title,new.body);
END;

CREATE TRIGGER posts_stats_insert AFTER INSERT ON posts BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=new.id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER posts_stats_update AFTER UPDATE OF view_count,engaged_view_count,deep_view_count ON posts BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=new.id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER comments_stats_insert AFTER INSERT ON comments BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=new.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER comments_stats_update AFTER UPDATE OF moderation_status,post_id ON comments BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=new.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=old.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER comments_stats_delete AFTER DELETE ON comments BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=old.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER post_votes_stats_insert AFTER INSERT ON post_votes BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=new.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER post_votes_stats_update AFTER UPDATE ON post_votes BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=new.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=old.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

CREATE TRIGGER post_votes_stats_delete AFTER DELETE ON post_votes BEGIN
  INSERT INTO post_stats(post_id,comment_count,score,view_count,engaged_view_count,deep_view_count)
  SELECT p.id,(SELECT count(*) FROM comments WHERE post_id=p.id AND moderation_status='approved'),
  (SELECT coalesce(sum(value),0) FROM post_votes WHERE post_id=p.id),p.view_count,p.engaged_view_count,p.deep_view_count
  FROM posts p WHERE p.id=old.post_id
  ON CONFLICT(post_id) DO UPDATE SET comment_count=excluded.comment_count,score=excluded.score,
  view_count=excluded.view_count,engaged_view_count=excluded.engaged_view_count,deep_view_count=excluded.deep_view_count,
  updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now');
END;

-- JSON-array providers require trigger checks because SQLite CHECK cannot use json_each subqueries.
CREATE TRIGGER media_providers_insert BEFORE INSERT ON media_settings BEGIN
  SELECT CASE WHEN json_type(new.secondary_providers) <> 'array'
    OR EXISTS(SELECT 1 FROM json_each(new.secondary_providers) WHERE value NOT IN ('filesystem','s3','ipfs') OR value=new.primary_provider)
    THEN RAISE(ABORT,'invalid secondary media providers') END;
END;
CREATE TRIGGER media_providers_update BEFORE UPDATE OF secondary_providers,primary_provider ON media_settings BEGIN
  SELECT CASE WHEN json_type(new.secondary_providers) <> 'array'
    OR EXISTS(SELECT 1 FROM json_each(new.secondary_providers) WHERE value NOT IN ('filesystem','s3','ipfs') OR value=new.primary_provider)
    THEN RAISE(ABORT,'invalid secondary media providers') END;
END;
INSERT INTO media_settings(singleton) VALUES(1);
INSERT INTO adsense_settings(singleton) VALUES(1);
INSERT INTO instance_modules(module_key,enabled) VALUES('orchard',1),('content_runners',0),('moderation',1),('adsense',0);
INSERT INTO communities(slug,name,description) VALUES('general','General','A place for links and discussions that do not fit another community.');

INSERT INTO communities(slug,name,description) VALUES
('x_imports','From X','Public posts shared from X, with source attribution and separate local discussions.'),
('alexandra_daddario','Alexandra Daddario','An independent fan community for publicly sourced photos and discussion. Not affiliated with Alexandra Daddario.')
ON CONFLICT(slug) DO NOTHING;

INSERT INTO communities(slug,name,description)
VALUES (
    'sydney_sweeney',
    'Sydney Sweeney',
    'An independent fan community for publicly sourced Sydney Sweeney content and discussion. Not affiliated with Sydney Sweeney.'
)
ON CONFLICT(slug) DO NOTHING;

INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Sydney Sweeney · X',
    'x',
    'search:("Sydney Sweeney" OR "SydneySweeney") has:media -is:retweet -is:reply',
    c.id,
    86400,
    10,
    'review',
    '{}'
FROM communities c
WHERE c.slug = 'sydney_sweeney'
ON CONFLICT(name) DO NOTHING;

INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Sydney Sweeney · Reddit',
    'reddit',
    'r/SydneySweeney',
    c.id,
    86400,
    10,
    'review',
    '{}'
FROM communities c
WHERE c.slug = 'sydney_sweeney'
ON CONFLICT(name) DO NOTHING;


INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Protestant and Biblical · X',
    'x',
    'search:(Presbyterian OR Presbyterianism OR Reformed OR Calvinist OR "Westminster Confession" OR "sola scriptura" OR "sola fide" OR biblical OR expository) -is:retweet -is:reply lang:en',
    c.id,
    21600,
    10,
    'review',
    '{"focus":"protestant","priority_terms":["presbyterian","reformed","calvinist","westminster confession","sola scriptura","sola fide","biblical","expository"]}'
FROM communities c
WHERE c.slug = 'x_imports'
ON CONFLICT(name) DO NOTHING;

INSERT INTO crawler_jobs(
    name, provider, source, community_id, interval_seconds, max_items, mode, filters
)
SELECT
    'Protestant and Biblical · Reddit',
    'reddit',
    'search:(Presbyterian OR Reformed OR Calvinist OR "Westminster Confession" OR "sola scriptura" OR "sola fide" OR biblical OR expository)',
    c.id,
    21600,
    10,
    'review',
    '{"focus":"protestant","priority_terms":["presbyterian","reformed","calvinist","westminster confession","sola scriptura","sola fide","biblical","expository"]}'
FROM communities c
WHERE c.slug = 'x_imports'
ON CONFLICT(name) DO NOTHING;

INSERT INTO content_runners(
    name, kind, command, prompt, author_id, community_id, interval_seconds,
    days_of_week, priority, enabled, next_run_at, state, environment_keys,
    capture_output, max_log_bytes
)
SELECT
    'X Recommended · one unique link',
    'cross_post',
    '["node", "scripts/x-recommended-session-runner.mjs"]',
    'Collect one unseen public post from the X Recommended timeline.',
    a.id,
    c.id,
    60,
    '[1, 2, 3, 4, 5, 6, 7]',
    100,
    FALSE,
    strftime('%Y-%m-%dT%H:%M:%fZ','now'),
    'draft',
    '["EGO_BROWSER_SPACE_ID", "EGO_BROWSER_CLI"]',
    TRUE,
    20000
FROM authors a
CROSS JOIN communities c
WHERE a.handle = 'import_scheduler'
  AND c.slug = 'x_imports'
ON CONFLICT (name) DO NOTHING;

INSERT INTO communities (slug, name, description)
VALUES ('general', 'General', 'A place for links and discussions that do not fit another community.')
ON CONFLICT (slug) DO NOTHING;

-- Timestamp comparisons normalize RFC3339 encodings with julianday().
CREATE INDEX sessions_expiry_jd ON sessions(julianday(expires_at));
CREATE INDEX post_view_visits_expiry_jd ON post_view_visits(julianday(started_at));
CREATE INDEX posts_created_jd ON posts(julianday(created_at));
CREATE INDEX crawler_jobs_due_jd ON crawler_jobs(enabled,julianday(next_run_at));
CREATE INDEX content_runners_due_jd ON content_runners(enabled,julianday(next_run_at),priority,id);

WITH entries(slug,name,description,source) AS (VALUES
            (
                'baddies_athletic',
                'Baddies · Athletic',
                'Publicly sourced athletic, fitness, and sportswear content for adult audiences. Not affiliated with the people shown.',
                'search:("women''s fitness" OR "female athlete" OR sportswear OR "athletic woman") has:media -is:retweet -is:reply'
            ),
            (
                'baddies_fashion',
                'Baddies · Fashion',
                'Publicly sourced fashion, street-style, and editorial content for adult audiences. Not affiliated with the people shown.',
                'search:("women''s fashion" OR streetstyle OR "fashion editorial" OR model) has:media -is:retweet -is:reply'
            ),
            (
                'baddies_glamour',
                'Baddies · Glamour',
                'Publicly sourced glamour and beauty-editorial content for adult audiences. Not affiliated with the people shown.',
                'search:(glamour OR "beauty editorial" OR "glamour photography") has:media -is:retweet -is:reply'
            ),
            (
                'baddies_red_carpet',
                'Baddies · Red Carpet',
                'Publicly sourced premiere, awards, and red-carpet content for adult audiences. Not affiliated with the people shown.',
                'search:("red carpet" OR premiere OR awards) has:media -is:retweet -is:reply'
            )
        )
INSERT INTO communities(slug,name,description) SELECT slug,name,description FROM entries WHERE 1 ON CONFLICT(slug) DO NOTHING;

WITH entries(slug,name,description,source) AS (VALUES
            (
                'baddies_athletic',
                'Baddies · Athletic',
                'Publicly sourced athletic, fitness, and sportswear content for adult audiences. Not affiliated with the people shown.',
                'search:("women''s fitness" OR "female athlete" OR sportswear OR "athletic woman") has:media -is:retweet -is:reply'
            ),
            (
                'baddies_fashion',
                'Baddies · Fashion',
                'Publicly sourced fashion, street-style, and editorial content for adult audiences. Not affiliated with the people shown.',
                'search:("women''s fashion" OR streetstyle OR "fashion editorial" OR model) has:media -is:retweet -is:reply'
            ),
            (
                'baddies_glamour',
                'Baddies · Glamour',
                'Publicly sourced glamour and beauty-editorial content for adult audiences. Not affiliated with the people shown.',
                'search:(glamour OR "beauty editorial" OR "glamour photography") has:media -is:retweet -is:reply'
            ),
            (
                'baddies_red_carpet',
                'Baddies · Red Carpet',
                'Publicly sourced premiere, awards, and red-carpet content for adult audiences. Not affiliated with the people shown.',
                'search:("red carpet" OR premiere OR awards) has:media -is:retweet -is:reply'
            )
        )
INSERT INTO crawler_jobs(name,provider,source,community_id,interval_seconds,max_items,mode,filters) SELECT e.name || ' · X','x',e.source,c.id,86400,20,'review','{}' FROM entries e JOIN communities c ON c.slug=e.slug WHERE 1 ON CONFLICT(name) DO NOTHING;
