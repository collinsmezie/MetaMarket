-- AlterTable
ALTER TABLE "taxonomy_nodes" ADD COLUMN     "search_vector" tsvector;

-- CreateIndex
CREATE INDEX "taxonomy_nodes_search_vector_idx" ON "taxonomy_nodes" USING GIN ("search_vector");
