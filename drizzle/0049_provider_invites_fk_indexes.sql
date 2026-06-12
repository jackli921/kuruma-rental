CREATE INDEX "idx_provider_invites_operatorId" ON "provider_invites" USING btree ("operatorId");--> statement-breakpoint
CREATE INDEX "idx_provider_invites_invitedByUserId" ON "provider_invites" USING btree ("invitedByUserId");--> statement-breakpoint
CREATE INDEX "idx_provider_invites_acceptedByUserId" ON "provider_invites" USING btree ("acceptedByUserId");