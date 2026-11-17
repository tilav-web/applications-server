import type { IGraphData } from '../financial-flow/financial-flow.service';
import type { EntityLinkRole } from './entities/entity-application-link.entity';

export type DossierEntityType = 'citizen' | 'card' | 'phone' | 'identifier' | 'application';

export interface INetworkNode {
  id: string;
  entityId: string;
  nodeType: 'CITIZEN' | 'CARD' | 'PHONE' | 'IDENTIFIER' | 'APPLICATION';
  label: string;
  sublabel?: string;
  role: 'VICTIM' | 'SUSPECT' | 'DROPPER' | 'TRANSIT' | 'MIXED' | 'APPLICATION' | 'NEUTRAL';
  riskScore: number;
  appsCount: number;
  amount?: number;
  isCenter?: boolean;
  targetRoute: string;
}

export interface INetworkEdge {
  id: string;
  from: string;
  to: string;
  relationType: 'OWNERSHIP' | 'TRANSFER' | 'SUSPECT_CLUE' | 'VICTIM_LINK' | 'PROBABLE_MATCH';
  label: string;
  amount?: number;
  isDashed?: boolean;
}

export interface INetworkGraph {
  nodes: INetworkNode[];
  edges: INetworkEdge[];
}

export interface DossierApplicationItem {
  id: string;
  application_number: string;
  description: string | null;
  officer_notes?: string | null;
  status: string | null;
  status_label: string;
  status_color: string;
  date: string | null;
  district_id?: string | null;
  district_name?: string | null;
  crime_article?: string | null;
  crime_method?: string | null;
  victim_name?: string | null;
  victim_phone?: string | null;
  role_in_app: EntityLinkRole;
  link_source: string;
  match_reasons: string[];
  transfer_amount: number | null;
  currency: string;
  payment_provider?: string | null;
  can_edit: boolean;
}

export interface MultiHopChainItem {
  target_application: DossierApplicationItem;
  hops_count: number;
  chain_steps: string[];
  intermediate_entities: {
    type: string;
    label: string;
    route: string;
  }[];
}

export interface ProbableMatchItem {
  id: string;
  match_type: 'CARD_OWNER_NAME' | 'MASKED_CARD_DIGITS' | 'SIMILAR_CITIZEN_NAME';
  confidence: number;
  title: string;
  subtitle: string;
  reason: string;
  target_entity_type: 'card' | 'citizen';
  target_entity_id: string;
  target_route: string;
  linked_apps_count: number;
  total_amount: number;
  confirm_action: {
    action_type: 'BIND_CARD_TO_CITIZEN' | 'LINK_CITIZEN_TO_CARD';
    citizen_id: string;
    card_id: string;
  };
}

export interface CoOccurringClueItem {
  id: string;
  entity_type: 'card' | 'phone' | 'identifier' | 'citizen';
  type_label: string;
  value: string;
  owner_name?: string | null;
  shared_apps_count: number;
  role: string;
  target_route: string;
}

export interface DossierMicroStats {
  totalApplications: number;
  victimAppsCount: number;
  suspectOrDropperAppsCount: number;
  witnessAppsCount: number;
  isCrossRoleCollision: boolean;
  totalLossInLinkedApps: number;
  totalIncomingAmount: number;
  totalOutgoingAmount: number;
  netFlowAmount: number;
  transactionsCount: number;
  avgTransactionAmount: number;
  maxTransactionAmount: number;
  firstSeenDate: string | null;
  lastSeenDate: string | null;
  activeSpanDays: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  riskLabel: string;
  hourlyDistribution: { slot: string; count: number; amount: number }[];
  byDistrict: { name: string; count: number; loss: number }[];
  byPaymentProvider: { name: string; count: number; amount: number }[];
  byCrime: { article: string; title: string | null; count: number }[];
}

export interface DossierTransferItem {
  id: string;
  transaction_id: string | null;
  direction: 'INCOMING' | 'OUTGOING' | 'INTERNAL';
  amount: number;
  currency: string;
  transfer_date: string | null;
  transfer_time: string | null;
  payment_provider: string | null;
  sender_card_id: string | null;
  sender_card_number: string | null;
  sender_owner_name: string | null;
  receiver_card_id: string | null;
  receiver_card_number: string | null;
  receiver_owner_name: string | null;
  application_id: string | null;
  application_number: string | null;
  images: string[];
}

export interface GlobalSearchResultItem {
  id: string;
  category: 'citizens' | 'cards' | 'phones' | 'identifiers' | 'applications' | 'transfers';
  title: string;
  subtitle: string;
  badgeLabel: string;
  badgeVariant: 'danger' | 'warning' | 'info' | 'success' | 'neutral';
  appsCount: number;
  totalAmount: number;
  riskScore: number;
  targetRoute: string;
}

export interface GlobalSearchResponse {
  query: string;
  totalCount: number;
  items: GlobalSearchResultItem[];
  countsByCategory: Record<string, number>;
}

export interface LiveRadarResponse {
  found: boolean;
  entityType?: 'card' | 'phone' | 'identifier' | 'citizen';
  entityId?: string;
  title?: string;
  subtitle?: string;
  targetRoute?: string;
  ownerCitizen?: {
    id: string;
    fullName: string;
    phone?: string | null;
  } | null;
  appsCount: number;
  suspectCount: number;
  victimCount: number;
  totalLoss: number;
  riskLevel: 'NONE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  recentApplications: {
    id: string;
    application_number: string;
    role: string;
    date: string | null;
    amount: number | null;
  }[];
}

export interface FullDossierResponse {
  entityType: 'citizen' | 'card' | 'phone' | 'identifier';
  canMutate: boolean;
  citizen?: Record<string, unknown> | null;
  card?: Record<string, unknown> | null;
  phone?: Record<string, unknown> | null;
  identifier?: Record<string, unknown> | null;
  ownedCards: Record<string, unknown>[];
  ownedPhones: Record<string, unknown>[];
  ownedIdentifiers: Record<string, unknown>[];
  stats: DossierMicroStats;
  directApplications: DossierApplicationItem[];
  multiHopChains: MultiHopChainItem[];
  probableMatches: ProbableMatchItem[];
  transfers: DossierTransferItem[];
  coOccurringClues: CoOccurringClueItem[];
  evidenceFiles: {
    url: string;
    title: string;
    application_id: string;
    application_number: string;
    is_image: boolean;
  }[];
  networkGraph: INetworkGraph;
  financialGraph: IGraphData;
}
