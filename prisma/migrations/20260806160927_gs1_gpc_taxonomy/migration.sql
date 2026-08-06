-- DropIndex
DROP INDEX "workflow_instances_fingerprint_embedding_hnsw";

-- CreateTable
CREATE TABLE "taxonomy_nodes" (
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "definition" TEXT NOT NULL DEFAULT '',
    "definition_excludes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "parent_code" TEXT,
    "segment_code" TEXT,
    "family_code" TEXT,
    "class_code" TEXT,
    "brick_code" TEXT,
    "embedded_text" TEXT,
    "embedding" vector(1536),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "taxonomy_nodes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "taxonomy_imports" (
    "id" UUID NOT NULL,
    "language_code" TEXT NOT NULL,
    "published_on" TEXT NOT NULL,
    "source_file" TEXT NOT NULL,
    "source_sha256" TEXT NOT NULL,
    "nodes_imported" INTEGER NOT NULL,
    "nodes_embedded" INTEGER NOT NULL,
    "embedded_to_level" INTEGER NOT NULL,
    "embedding_model" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "taxonomy_imports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "taxonomy_nodes_level_idx" ON "taxonomy_nodes"("level");

-- CreateIndex
CREATE INDEX "taxonomy_nodes_parent_code_idx" ON "taxonomy_nodes"("parent_code");

-- CreateIndex
CREATE INDEX "taxonomy_nodes_segment_code_idx" ON "taxonomy_nodes"("segment_code");

-- CreateIndex
CREATE INDEX "taxonomy_nodes_brick_code_idx" ON "taxonomy_nodes"("brick_code");

-- CreateIndex
CREATE INDEX "taxonomy_nodes_active_level_idx" ON "taxonomy_nodes"("active", "level");

-- CreateIndex
CREATE INDEX "taxonomy_imports_completed_at_idx" ON "taxonomy_imports"("completed_at");

-- AddForeignKey
ALTER TABLE "taxonomy_nodes" ADD CONSTRAINT "taxonomy_nodes_parent_code_fkey" FOREIGN KEY ("parent_code") REFERENCES "taxonomy_nodes"("code") ON DELETE SET NULL ON UPDATE NO ACTION;
