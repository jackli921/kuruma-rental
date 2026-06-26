import type { RateLimitBinding } from '@elithrar/workers-hono-rate-limit'
import type { GoogleAuthRuntime } from './auth/google'
import type {
  AddOnRepository,
  AvailabilityRepository,
  BookingRepository,
  ClassRatePlanRepository,
  ComplianceAlertLogRepository,
  ConsentRepository,
  CustomerRepository,
  DocumentStorage,
  FeeScheduleRepository,
  FleetOverviewRepository,
  InsuranceOptionRepository,
  LocationRepository,
  MaintenanceLogRepository,
  MessageRepository,
  NotificationLogRepository,
  OperatorMembershipRepository,
  OperatorRepository,
  OverviewRepository,
  PaymentAnomalyRepository,
  PaymentEventRepository,
  PaymentRefundRepository,
  PhotoStorage,
  ProviderInviteRepository,
  RefundReconcilerRepository,
  RegionRepository,
  RenterDocumentRepository,
  StatsRepository,
  StorefrontRepository,
  ThreadRepository,
  UserRepository,
  VehicleBlockRepository,
  VehicleClassRepository,
  VehicleDetailRepository,
  VehicleRepository,
} from './repositories/types'
import type { EmailSender } from './services/email/email-sender'
import type { GeocodeCache, Geocoder } from './services/geocoding/types'
import type { PaymentGateway } from './services/payment/payment-gateway'

/**
 * Test/runtime injection seams for {@link createApp}. The three non-optional
 * repos are the in-memory test trio every route suite supplies; the rest fall
 * back to env-resolved concretes wired in the composition root.
 */
export type AppOverrides = {
  vehicleRepo: VehicleRepository
  bookingRepo: BookingRepository
  availabilityRepo: AvailabilityRepository
  fleetOverviewRepo?: FleetOverviewRepository
  vehicleDetailRepo?: VehicleDetailRepository
  statsRepo?: StatsRepository
  overviewRepo?: OverviewRepository
  threadRepo?: ThreadRepository
  messageRepo?: MessageRepository
  vehicleClassRepo?: VehicleClassRepository
  maintenanceLogRepo?: MaintenanceLogRepository
  vehicleBlockRepo?: VehicleBlockRepository
  photoStorage?: PhotoStorage
  renterDocumentRepo?: RenterDocumentRepository
  documentStorage?: DocumentStorage
  userRepo?: UserRepository
  customerRepo?: CustomerRepository
  operatorRepo?: OperatorRepository
  locationRepo?: LocationRepository
  insuranceOptionRepo?: InsuranceOptionRepository
  addOnRepo?: AddOnRepository
  feeScheduleRepo?: FeeScheduleRepository
  classRatePlanRepo?: ClassRatePlanRepository
  notificationLogRepo?: NotificationLogRepository
  complianceAlertLogRepo?: ComplianceAlertLogRepository
  storefrontRepo?: StorefrontRepository
  regionRepo?: RegionRepository
  paymentEventRepo?: PaymentEventRepository
  paymentRefundRepo?: PaymentRefundRepository
  refundReconcilerRepo?: RefundReconcilerRepository
  paymentAnomalyRepo?: PaymentAnomalyRepository
  providerInviteRepo?: ProviderInviteRepository
  operatorMembershipRepo?: OperatorMembershipRepository
  consentRepo?: ConsentRepository
  // Inject a fake outbound email port in tests; absent ⇒ the env-resolved
  // Resend/dev-stub/sentinel (resolveEmailSender). Shared by the booking
  // dispatcher and the #916 compliance digest.
  emailSender?: EmailSender
  // Inject a fake gateway in tests; absent ⇒ the env-resolved Stripe/sentinel.
  paymentGateway?: PaymentGateway
  // Inject a fake Geocoder in tests (proves a provider swap touches only here);
  // absent ⇒ the env-resolved Nominatim/null-stub.
  geocoder?: Geocoder
  // Inject a fake geocode cache in tests; absent ⇒ the env-resolved Workers KV
  // cache (when the GEOCODE_CACHE binding exists, #304) or an in-process map. The
  // cache wraps the geocoder so a repeated address skips the provider call and the
  // 1-req/10s budget (#601).
  geocodeCache?: GeocodeCache
  photoUploadLimiter?: RateLimitBinding
  photoUploadUserLimiter?: RateLimitBinding
  publicCatalogLimiter?: RateLimitBinding
  // Over-limit ⇒ the geocoder skips the lookup (#574). Inject a deny-binding in
  // tests; absent ⇒ the globalThis-resolved GEOCODE_LIMITER (or unthrottled dev).
  geocodeLimiter?: RateLimitBinding
  // Injected Google OAuth runtime (provider + account store). Integration tests
  // pass a fake so the callback can be exercised without a live Google/DB.
  googleAuthRuntime?: GoogleAuthRuntime
}
