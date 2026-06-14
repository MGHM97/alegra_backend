-- CreateTable
CREATE TABLE "seasonal_campaigns" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "ribbon" TEXT NOT NULL,
    "eyebrow" TEXT NOT NULL,
    "emoji" VARCHAR(16) NOT NULL,
    "accent" VARCHAR(7) NOT NULL,
    "accent_text" VARCHAR(7) NOT NULL,
    "start_month" INTEGER NOT NULL,
    "start_day" INTEGER NOT NULL,
    "end_month" INTEGER NOT NULL,
    "end_day" INTEGER NOT NULL,
    "year" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "seasonal_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "seasonal_campaigns_key_key" ON "seasonal_campaigns"("key");

-- CreateIndex
CREATE INDEX "seasonal_campaigns_is_active_idx" ON "seasonal_campaigns"("is_active");

-- CreateIndex
CREATE INDEX "seasonal_campaigns_priority_idx" ON "seasonal_campaigns"("priority");
