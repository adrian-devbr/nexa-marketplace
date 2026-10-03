CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY,
    name VARCHAR(60) NOT NULL,
    email VARCHAR(254) NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    blocked_at TIMESTAMPTZ
);

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'user';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'users_role_check'
          AND conrelid = 'users'::regclass
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('user', 'admin'));
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY,
    owner_id UUID NOT NULL REFERENCES users(id),
    type VARCHAR(10) NOT NULL CHECK (type IN ('produto', 'servico')),
    title VARCHAR(80) NOT NULL,
    category VARCHAR(40) NOT NULL,
    description VARCHAR(500) NOT NULL,
    price_cents BIGINT NOT NULL CHECK (price_cents > 0),
    image_url TEXT,
    status VARCHAR(12) NOT NULL DEFAULT 'published'
        CHECK (status IN ('pending', 'published', 'hidden', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS listings_published_created_idx
    ON listings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS listings_owner_idx ON listings (owner_id);

UPDATE listings SET status = 'published', updated_at = NOW()
WHERE status = 'pending';

ALTER TABLE listings ALTER COLUMN status SET DEFAULT 'published';

CREATE TABLE IF NOT EXISTS listing_reports (
    id UUID PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    reporter_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(30) NOT NULL CHECK (reason IN
        ('fraud', 'prohibited', 'misleading', 'duplicate', 'other')),
    details VARCHAR(500) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'hidden')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id),
    UNIQUE (listing_id, reporter_id)
);

CREATE INDEX IF NOT EXISTS listing_reports_queue_idx
    ON listing_reports (status, created_at) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS blocked_users (
    blocker_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (blocker_id, blocked_id),
    CHECK (blocker_id <> blocked_id)
);

CREATE TABLE IF NOT EXISTS conversations (
    id UUID PRIMARY KEY,
    listing_id UUID NOT NULL REFERENCES listings(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_by_buyer BOOLEAN NOT NULL DEFAULT FALSE,
    deleted_by_seller BOOLEAN NOT NULL DEFAULT FALSE,
    CHECK (buyer_id <> seller_id),
    UNIQUE (listing_id, buyer_id, seller_id)
);

CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id UUID NOT NULL REFERENCES users(id),
    recipient_id UUID NOT NULL REFERENCES users(id),
    body VARCHAR(2000) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ,
    CONSTRAINT messages_sender_recipient_check CHECK (sender_id <> recipient_id)
);

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS recipient_id UUID REFERENCES users(id);

UPDATE messages m
SET recipient_id = CASE
    WHEN m.sender_id = c.buyer_id THEN c.seller_id
    ELSE c.buyer_id
END
FROM conversations c
WHERE m.conversation_id = c.id
  AND m.recipient_id IS NULL;

ALTER TABLE messages
    ALTER COLUMN recipient_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'messages_sender_recipient_check'
          AND conrelid = 'messages'::regclass
    ) THEN
        ALTER TABLE messages ADD CONSTRAINT messages_sender_recipient_check
            CHECK (sender_id <> recipient_id);
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
    ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_recipient_unread_idx
    ON messages (recipient_id, read_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(40) NOT NULL,
    title VARCHAR(120) NOT NULL,
    body VARCHAR(500) NOT NULL,
    resource_type VARCHAR(30),
    resource_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
    ON notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS platform_fee_tiers (
    id UUID PRIMARY KEY,
    min_cents BIGINT NOT NULL CHECK (min_cents >= 0),
    max_cents BIGINT CHECK (max_cents IS NULL OR max_cents >= min_cents),
    rate_basis_points INTEGER NOT NULL CHECK (rate_basis_points BETWEEN 0 AND 10000),
    listing_type VARCHAR(10) CHECK (listing_type IS NULL OR listing_type IN ('produto', 'servico')),
    seller_id UUID REFERENCES users(id) ON DELETE CASCADE,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS platform_fee_tiers_lookup_idx
    ON platform_fee_tiers (min_cents, max_cents) WHERE listing_type IS NULL AND seller_id IS NULL;

INSERT INTO platform_fee_tiers
    (id, min_cents, max_cents, rate_basis_points)
SELECT gen_random_uuid(), tier.min_cents, tier.max_cents, tier.rate_basis_points
FROM (VALUES
    (0::bigint, 5000::bigint, 1000),
    (5001::bigint, 20000::bigint, 800),
    (20001::bigint, 50000::bigint, 600),
    (50001::bigint, 100000::bigint, 500),
    (100001::bigint, NULL::bigint, 400)
) AS tier(min_cents, max_cents, rate_basis_points)
WHERE NOT EXISTS (
    SELECT 1 FROM platform_fee_tiers
    WHERE listing_type IS NULL AND seller_id IS NULL
);

CREATE TABLE IF NOT EXISTS orders (
    id UUID PRIMARY KEY,
    order_number BIGINT GENERATED ALWAYS AS IDENTITY UNIQUE,
    listing_id UUID NOT NULL REFERENCES listings(id),
    buyer_id UUID NOT NULL REFERENCES users(id),
    seller_id UUID NOT NULL REFERENCES users(id),
    quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
    unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents > 0),
    total_cents BIGINT NOT NULL CHECK (total_cents > 0),
    fee_tier_id UUID REFERENCES platform_fee_tiers(id) ON DELETE SET NULL,
    platform_fee_rate_basis_points INTEGER NOT NULL DEFAULT 0
        CHECK (platform_fee_rate_basis_points BETWEEN 0 AND 10000),
    platform_fee_cents BIGINT NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
    provider_fee_cents BIGINT CHECK (provider_fee_cents IS NULL OR provider_fee_cents >= 0),
    seller_net_cents BIGINT CHECK (seller_net_cents IS NULL OR seller_net_cents >= 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'paid', 'in_progress', 'ready', 'completed', 'cancelled', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (buyer_id <> seller_id)
);

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS fee_tier_id UUID REFERENCES platform_fee_tiers(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS platform_fee_rate_basis_points INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS platform_fee_cents BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS provider_fee_cents BIGINT,
    ADD COLUMN IF NOT EXISTS seller_net_cents BIGINT;

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE orders ADD CONSTRAINT orders_status_check
    CHECK (status IN ('pending', 'accepted', 'paid', 'in_progress', 'ready', 'completed', 'cancelled', 'rejected'));

CREATE TABLE IF NOT EXISTS order_status_history (
    id UUID PRIMARY KEY,
    event_number BIGINT GENERATED ALWAYS AS IDENTITY,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL,
    actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
    details VARCHAR(300) NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE order_status_history
    ADD COLUMN IF NOT EXISTS event_number BIGINT GENERATED ALWAYS AS IDENTITY;

CREATE INDEX IF NOT EXISTS order_status_history_order_idx
    ON order_status_history (order_id, created_at, event_number);

INSERT INTO order_status_history (id, order_id, status, details, created_at)
SELECT gen_random_uuid(), o.id, o.status, 'Histórico inicializado durante atualização do NEXA.', o.created_at
FROM orders o
WHERE NOT EXISTS (
    SELECT 1 FROM order_status_history h WHERE h.order_id = o.id
);

CREATE INDEX IF NOT EXISTS orders_buyer_created_idx ON orders (buyer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_seller_created_idx ON orders (seller_id, created_at DESC);

CREATE TABLE IF NOT EXISTS reviews (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL REFERENCES orders(id),
    reviewer_id UUID NOT NULL REFERENCES users(id),
    subject_id UUID NOT NULL REFERENCES users(id),
    rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
    comment VARCHAR(1000) NOT NULL DEFAULT '',
    reported_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (order_id, reviewer_id),
    CHECK (reviewer_id <> subject_id)
);

CREATE INDEX IF NOT EXISTS reviews_subject_idx ON reviews (subject_id, created_at DESC);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY,
    order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
    provider VARCHAR(30) NOT NULL DEFAULT 'mercadopago',
    provider_payment_id TEXT UNIQUE,
    checkout_url TEXT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled', 'refunded')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_events (
    provider_event_id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
