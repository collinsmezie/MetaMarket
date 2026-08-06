-- DropIndex
DROP INDEX "taxonomy_nodes_embedding_hnsw";

-- CreateTable
CREATE TABLE "taxonomy_attributes" (
    "code" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "definition" TEXT NOT NULL DEFAULT '',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "taxonomy_attributes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "brick_attribute_types" (
    "brick_code" TEXT NOT NULL,
    "attribute_type_code" TEXT NOT NULL,

    CONSTRAINT "brick_attribute_types_pkey" PRIMARY KEY ("brick_code","attribute_type_code")
);

-- CreateTable
CREATE TABLE "brick_attribute_values" (
    "brick_code" TEXT NOT NULL,
    "attribute_type_code" TEXT NOT NULL,
    "attribute_value_code" TEXT NOT NULL,

    CONSTRAINT "brick_attribute_values_pkey" PRIMARY KEY ("brick_code","attribute_type_code","attribute_value_code")
);

-- CreateIndex
CREATE INDEX "taxonomy_attributes_level_idx" ON "taxonomy_attributes"("level");

-- CreateIndex
CREATE INDEX "brick_attribute_types_attribute_type_code_idx" ON "brick_attribute_types"("attribute_type_code");

-- CreateIndex
CREATE INDEX "brick_attribute_values_attribute_value_code_idx" ON "brick_attribute_values"("attribute_value_code");

-- AddForeignKey
ALTER TABLE "brick_attribute_types" ADD CONSTRAINT "brick_attribute_types_brick_code_fkey" FOREIGN KEY ("brick_code") REFERENCES "taxonomy_nodes"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brick_attribute_types" ADD CONSTRAINT "brick_attribute_types_attribute_type_code_fkey" FOREIGN KEY ("attribute_type_code") REFERENCES "taxonomy_attributes"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brick_attribute_values" ADD CONSTRAINT "brick_attribute_values_brick_code_fkey" FOREIGN KEY ("brick_code") REFERENCES "taxonomy_nodes"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brick_attribute_values" ADD CONSTRAINT "brick_attribute_values_attribute_type_code_fkey" FOREIGN KEY ("attribute_type_code") REFERENCES "taxonomy_attributes"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brick_attribute_values" ADD CONSTRAINT "brick_attribute_values_attribute_value_code_fkey" FOREIGN KEY ("attribute_value_code") REFERENCES "taxonomy_attributes"("code") ON DELETE CASCADE ON UPDATE CASCADE;
