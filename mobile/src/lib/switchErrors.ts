/**
 * Classifier mapping RevenueCat / Linking failures into the editorial
 * copy used by PurchaseFailureSheet. Pure function, no UI imports — keeps
 * /plans free of error-code branching.
 *
 * Match by the string `code` value so the classifier is robust against
 * RC enum reordering and version drift across iOS/Android. The full enum
 * lives in @revenuecat/purchases-typescript-internal/dist/errors.d.ts;
 * we mirror only the codes we differentiate. Anything we don't recognise
 * falls through to a generic retryable bucket.
 */

export type SwitchFailureKind =
  | "alreadyOwned"
  | "cancelled"
  | "network"
  | "store"
  | "pending"
  | "blocked"
  | "unavailable"
  | "inProgress"
  | "linkingFailed"
  | "generic";

export interface SwitchFailure {
  kind: SwitchFailureKind;
  /** Editorial title shown in the sheet. */
  title: string;
  /** One-paragraph plain-English explanation. */
  body: string;
  /** Whether the user can re-run the same purchase from the failure sheet. */
  retryable: boolean;
  /** Secondary affordance shown beneath the primary CTA. */
  secondary: "openSettings" | "support" | "close";
}

interface RCErrorLike {
  code?: string | number | null;
  userCancelled?: boolean | null;
  message?: string;
}

/**
 * Throw-shape used internally to mark Linking.openURL failures so they
 * land in the same classifier as RC errors.
 */
export class LinkingFailedError extends Error {
  readonly isLinkingFailure = true;
  constructor(message = "Linking failed") {
    super(message);
  }
}

export function classifySwitchError(err: unknown): SwitchFailure {
  if (err instanceof LinkingFailedError) {
    return {
      kind: "linkingFailed",
      title: "Couldn't open Settings.",
      body: "Open the Settings app and find Subscriptions to manage your plan.",
      retryable: true,
      secondary: "close",
    };
  }

  const e = (err ?? {}) as RCErrorLike;
  const code = e.code != null ? String(e.code) : "";

  // RC's PURCHASE_CANCELLED_ERROR is "1"; some platforms also set
  // userCancelled=true. Either signal means "stay silent".
  if (code === "1" || e.userCancelled === true) {
    return {
      kind: "cancelled",
      title: "",
      body: "",
      retryable: false,
      secondary: "close",
    };
  }

  switch (code) {
    case "6": // PRODUCT_ALREADY_PURCHASED_ERROR
    case "7": // RECEIPT_ALREADY_IN_USE_ERROR
      return {
        kind: "alreadyOwned",
        title: "",
        body: "",
        retryable: false,
        secondary: "close",
      };

    case "10": // NETWORK_ERROR
    case "35": // OFFLINE_CONNECTION_ERROR
      return {
        kind: "network",
        title: "We lost the connection.",
        body: "Check your network and try again.",
        retryable: true,
        secondary: "close",
      };

    case "2": // STORE_PROBLEM_ERROR
    case "8": // INVALID_RECEIPT_ERROR
    case "12": // UNEXPECTED_BACKEND_RESPONSE_ERROR
    case "16": // UNKNOWN_BACKEND_ERROR
      return {
        kind: "store",
        title: "Your store had an issue.",
        body: "The store reported a problem with the purchase. Try again in a moment.",
        retryable: true,
        secondary: "support",
      };

    case "20": // PAYMENT_PENDING_ERROR
      return {
        kind: "pending",
        title: "Waiting on approval.",
        body: "This payment needs to be approved (often a Family or Screen Time check). We'll update your plan once it clears.",
        retryable: false,
        secondary: "close",
      };

    case "3": // PURCHASE_NOT_ALLOWED_ERROR
    case "19": // INSUFFICIENT_PERMISSIONS_ERROR
      return {
        kind: "blocked",
        title: "Purchases aren't allowed.",
        body: "This account can't make purchases. Check Screen Time or Family Sharing settings.",
        retryable: false,
        secondary: "openSettings",
      };

    case "5": // PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR
    case "32": // PRODUCT_REQUEST_TIMED_OUT_ERROR
      return {
        kind: "unavailable",
        title: "Plan unavailable right now.",
        body: "We couldn't load this plan from the store. Try again or get in touch.",
        retryable: true,
        secondary: "support",
      };

    case "15": // OPERATION_ALREADY_IN_PROGRESS_ERROR
      return {
        kind: "inProgress",
        title: "A switch is already in progress.",
        body: "Wait a few seconds and try again.",
        retryable: true,
        secondary: "close",
      };

    default:
      return {
        kind: "generic",
        title: "Something went sideways.",
        body: "Try again, or contact support if it keeps happening.",
        retryable: true,
        secondary: "support",
      };
  }
}
