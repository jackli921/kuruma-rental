ALTER TABLE "vehicles" DROP CONSTRAINT "vehicles_classId_vehicle_classes_id_fk";
--> statement-breakpoint
ALTER TABLE "vehicle_classes" ADD CONSTRAINT "vehicle_classes_operatorId_id_unique" UNIQUE("operatorId","id");--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_operatorId_classId_fk" FOREIGN KEY ("operatorId","classId") REFERENCES "public"."vehicle_classes"("operatorId","id") ON DELETE no action ON UPDATE no action;
