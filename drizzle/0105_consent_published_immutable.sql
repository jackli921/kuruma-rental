-- §5.1: consent_documents is INSERTed at runtime for the first time (operator
-- authoring). A PUBLISHED legal document is immutable; new wording is a new
-- version row. This trigger is the DB seal (the service also refuses). Snapshot-
-- invisible (triggers are not expressible in drizzle's table builder), so it
-- causes no schema-vs-snapshot drift.
CREATE OR REPLACE FUNCTION consent_documents_block_published_update() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.title <> OLD.title
       OR NEW.body <> OLD.body
       OR NEW."acceptanceLabel" <> OLD."acceptanceLabel"
       OR NEW."contentHash" <> OLD."contentHash"
       OR NEW.type <> OLD.type
       OR NEW.version <> OLD.version
       OR NEW.locale <> OLD.locale
       OR NEW."effectiveFrom" <> OLD."effectiveFrom"
       OR NEW."operatorId" IS DISTINCT FROM OLD."operatorId"
    THEN
      RAISE EXCEPTION 'consent_documents: PUBLISHED rows are immutable (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status <> OLD.status AND NEW.status <> 'ARCHIVED' THEN
      RAISE EXCEPTION 'consent_documents: PUBLISHED may only transition to ARCHIVED (id=%)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_documents_immutable_published
  BEFORE UPDATE ON consent_documents
  FOR EACH ROW EXECUTE FUNCTION consent_documents_block_published_update();
