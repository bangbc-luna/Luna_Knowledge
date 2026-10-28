CREATE TYPE "DocumentFormat" AS ENUM ('RICH', 'LATEX');

ALTER TABLE "documents" ADD COLUMN "format" "DocumentFormat" NOT NULL DEFAULT 'RICH';
