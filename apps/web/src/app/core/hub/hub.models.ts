import type { components, paths } from '@echocall/whitelabel-api-client';

/**
 * The hub schemas the workspace pages consume, re-exported under their
 * documented names so feature code never repeats the components[...] lookup.
 */
type Schemas = components['schemas'];

export type Pagination = Schemas['Pagination'];

export type Agent = Schemas['Agent'];
export type AgentSummary = Schemas['AgentSummary'];
export type CreateAgent = Schemas['CreateAgent'];
export type UpdateAgent = Schemas['UpdateAgent'];
export type KnowledgeEntry = Schemas['KnowledgeEntry'];
export type AddKnowledge = Schemas['AddKnowledge'];
export type Voice = Schemas['Voice'];
export type AvailableVoice = Schemas['AvailableVoice'];
export type Language = Schemas['Language'];
/** A language an agent can speak or write, with names for display. */
export type AgentLanguage = Schemas['AgentLanguage'];

export type Chatbot = Schemas['Chatbot'];
export type ChatbotSummary = Schemas['ChatbotSummary'];
export type CreateChatbot = Schemas['CreateChatbot'];
export type UpdateChatbot = Schemas['UpdateChatbot'];
export type ChatbotKnowledgeEntry = Schemas['ChatbotKnowledgeEntry'];

export type Conversation = Schemas['Conversation'];
export type ConversationTranscriptMessage = Schemas['ConversationTranscriptMessage'];
export type LiveConversation = Schemas['LiveConversation'];
export type LiveMessage = Schemas['LiveMessage'];
export type SendMessage = Schemas['SendMessage'];
export type UpdateConversation = Schemas['UpdateConversation'];

export type PhoneNumber = Schemas['PhoneNumber'];
export type MarketplaceNumber = Schemas['MarketplaceNumber'];
/** A number that is set up already and bought at once from the balance, among them the operator's own on offer. */
export type InstantNumber = ListItem<GetBody<'/phone-numbers/instant'>>;
export type Country = Schemas['Country'];
export type KycRequirement = Schemas['KycRequirement'];

export type AnalyticsSummary = Schemas['AnalyticsSummary'];
export type DailyStat = Schemas['DailyStat'];
export type AgentStats = Schemas['AgentStats'];
export type ChatbotStats = Schemas['ChatbotStats'];

export type Integration = Schemas['Integration'];
export type IntegrationSummary = Schemas['IntegrationSummary'];
export type IntegrationType = Schemas['IntegrationType'];
export type CreateIntegration = Schemas['CreateIntegration'];
export type UpdateIntegration = Schemas['UpdateIntegration'];
export type CatalogTool = Schemas['CatalogTool'];
export type IntegrationPermissions = Schemas['IntegrationPermissions'];
export type UpdateIntegrationPermissions = Schemas['UpdateIntegrationPermissions'];
export type AssignedIntegration = Schemas['AssignedIntegration'];

export type Webhook = Schemas['Webhook'];
export type WebhookEvent = Schemas['WebhookEvent'];

export type Campaign = Schemas['Campaign'];
export type CampaignSummary = Schemas['CampaignSummary'];
export type Recipient = Schemas['Recipient'];

export type Ticket = Schemas['Ticket'];
export type TicketSummary = Schemas['TicketSummary'];
export type TicketMessage = Schemas['TicketMessage'];
export type CreateTicket = Schemas['CreateTicket'];
export type AddTicketMessage = Schemas['AddTicketMessage'];

export type HubNotification = Schemas['Notification'];

export type Balance = Schemas['Balance'];
export type Transaction = Schemas['Transaction'];
export type Invoice = Schemas['Invoice'];
export type Subscription = Schemas['Subscription'];
export type Plan = Schemas['Plan'];
export type AddonPackage = Schemas['AddonPackage'];

/*
 * Operator side. The admin panel reads the reseller group of the hub API, where
 * several list endpoints answer with rows the hub never gave a named schema:
 * those are derived from the path types instead of being repeated by hand.
 */

/** The JSON body of the 200 answer of a GET path. */
type GetBody<P extends keyof paths> = paths[P] extends {
  get: { responses: { 200: { content: { 'application/json': infer B } } } };
}
  ? B
  : never;

/**
 * One row of a list body, whether the endpoint answers with a bare array, a
 * `{ data }` envelope or the paged `{ data, pagination }` form.
 */
type ListItem<B> = B extends readonly (infer I)[] ? I : B extends { data: readonly (infer I)[] } ? I : never;

/** The JSON body a POST path expects. */
type PostBody<P extends keyof paths> = paths[P] extends {
  post: { requestBody: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

/** The JSON body a PATCH path expects. */
type PatchBody<P extends keyof paths> = paths[P] extends {
  patch: { requestBody: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

/** The JSON body of the 200 answer of a POST path. */
type PostResult<P extends keyof paths> = paths[P] extends {
  post: { responses: { 200: { content: { 'application/json': infer B } } } };
}
  ? B
  : never;

export type ResellerCustomer = Schemas['ResellerCustomer'];
export type ResellerStats = Schemas['ResellerStats'];
export type ResellerActivity = Schemas['ResellerActivity'];
export type ResellerCompany = Schemas['ResellerCompany'];
export type ResellerSettings = Schemas['ResellerSettings'];
export type ResellerPricing = Schemas['ResellerPricing'];
export type ResellerCredits = Schemas['ResellerCredits'];
export type ResellerCreditTransaction = Schemas['ResellerCreditTransaction'];
export type OwnerRef = Schemas['OwnerRef'];
export type UsageSummary = Schemas['UsageSummary'];
export type Limits = Schemas['Limits'];
export type UserProfile = Schemas['UserProfile'];

export type ResellerSubscriptionRow = ListItem<GetBody<'/resellers/subscriptions'>>;
export type ResellerInvoiceRow = ListItem<GetBody<'/resellers/invoices'>>;
export type ResellerInvoiceDetail = GetBody<'/resellers/invoices/{id}'>;
export type ResellerTicketRow = ListItem<GetBody<'/resellers/tickets'>>;
export type ResellerTicketDetail = GetBody<'/resellers/tickets/{id}'>;
export type ResellerTicketMessage = NonNullable<ResellerTicketDetail['messages']>[number];
export type ResellerAddonPackage = ListItem<GetBody<'/resellers/addons/packages'>>;
export type ResellerAddonPurchase = ListItem<GetBody<'/resellers/addons/purchases'>>;
export type ResellerAddonStats = GetBody<'/resellers/addons/stats'>;
export type ResellerCustomerTransaction = ListItem<GetBody<'/resellers/customers/{id}/transactions'>>;
export type ResellerCustomerDetail = GetBody<'/resellers/customers/{id}'>;
export type ResellerCustomerBalance = GetBody<'/resellers/customers/{id}/balance'>;
export type ResellerCustomerUsage = GetBody<'/resellers/customers/{id}/usage'>;
export type ResellerCustomerUsageRow = ResellerCustomerUsage['usage'][number];
export type ResellerCustomerSubscription = ListItem<GetBody<'/resellers/customers/{id}/subscriptions'>>;
export type ResellerAssignedNumber = ListItem<GetBody<'/resellers/phone-numbers/assigned'>>;
export type ResellerAvailableNumber = ListItem<GetBody<'/resellers/phone-numbers/available'>>;
export type ResellerVoiceAgentRow = ListItem<GetBody<'/resellers/voice-agents'>>;
export type ResellerChatbotRow = ListItem<GetBody<'/resellers/chatbots'>>;
export type ResellerRevenueAnalytics = GetBody<'/resellers/analytics/revenue'>;
export type ResellerUsageAnalytics = GetBody<'/resellers/analytics/usage'>;
export type ResellerPricingSuggestions = GetBody<'/resellers/pricing/suggestions'>;
export type ResellerPricingSuggestion = ListItem<ResellerPricingSuggestions>;

export type CreatePlanInput = PostBody<'/resellers/plans'>;
export type UpdatePlanInput = PatchBody<'/resellers/plans/{id}'>;
export type UpdatePricingInput = PatchBody<'/resellers/pricing'>;

/** What mailing an invoice would send, and why it cannot go out when it cannot. */
export type ResellerInvoiceMailPreview = GetBody<'/resellers/invoices/{id}/email-preview'>;
export type SendInvoiceInput = PostBody<'/resellers/invoices/{id}/send'>;
export type SendInvoiceResult = PostResult<'/resellers/invoices/{id}/send'>;

/** The JSON body a PUT path expects. */
type PutBody<P extends keyof paths> = paths[P] extends {
  put: { requestBody: { content: { 'application/json': infer B } } };
}
  ? B
  : never;

/** A customer's service order behind a ticket, with what handing it on would cost. */
export type ResellerServiceOrder = NonNullable<
  GetBody<'/resellers/services/orders/by-ticket/{ticketId}'>['data']
>;
export type ServiceOrderStep = PostBody<'/resellers/services/orders/{orderId}/status'>['status'];
export type ServiceForwardResult = PostResult<'/resellers/services/orders/{orderId}/forward'>['data'];
/** The platform's services with the operator's purchase and customer prices. */
export type ResellerServiceOffers = GetBody<'/resellers/services/offers'>['data'];
export type ResellerServiceOffer = ResellerServiceOffers['services'][number];
export type UpdateServiceOfferInput = PutBody<'/resellers/services/offers/{positionId}'>;
/** A service the operator offers and does themselves. */
export type ResellerOwnService = ListItem<GetBody<'/resellers/services/own'>>;
export type OwnServiceInput = PostBody<'/resellers/services/own'>;

/** The operator's own mail server as the service keeps it, never with its password. */
export type ResellerSmtp = NonNullable<GetBody<'/resellers/smtp'>['data']>;
/** Which server sends the operator's invoices and ticket mails right now. */
export type ResellerSmtpEffective = GetBody<'/resellers/smtp/effective'>['data'];
export type ResellerSmtpInput = PutBody<'/resellers/smtp'>;
export type ResellerSmtpTestResult = PostResult<'/resellers/smtp/test-email'>['data'];
