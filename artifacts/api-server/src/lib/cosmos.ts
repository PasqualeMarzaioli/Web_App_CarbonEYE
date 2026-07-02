/**
 * artifacts/api-server/src/lib/cosmos.ts — Manages Azure Cosmos DB connection and operations for storing and retrieving certificate records with lazy initialization.
 * Author: Pasquale Marzaioli
 */
import { CosmosClient, type Container } from "@azure/cosmos";
import { logger } from "./logger";

const CONNECTION = process.env.AZURE_COSMOS_CONNECTION_STRING;
const DATABASE = process.env.AZURE_COSMOS_DATABASE ?? "carboneye";
const CONTAINER = process.env.AZURE_COSMOS_CONTAINER ?? "certificates";

let cachedContainer: Container | null = null;
let initPromise: Promise<Container | null> | null = null;

async function init(): Promise<Container | null> {
  if (!CONNECTION) {
    logger.warn("AZURE_COSMOS_CONNECTION_STRING not set — Cosmos disabled");
    return null;
  }
  try {
    const client = new CosmosClient(CONNECTION);
    const { database } = await client.databases.createIfNotExists({ id: DATABASE });
    const { container } = await database.containers.createIfNotExists({
      id: CONTAINER,
      partitionKey: { paths: ["/company_name"] },
    });
    logger.info({ database: DATABASE, container: CONTAINER }, "Cosmos DB ready");
    return container;
  } catch (err) {
    logger.error({ err }, "Failed to initialize Cosmos DB");
    return null;
  }
}

export async function getCertificatesContainer(): Promise<Container | null> {
  if (cachedContainer) return cachedContainer;
  if (!initPromise) initPromise = init();
  cachedContainer = await initPromise;
  return cachedContainer;
}

export type CertificateRecord = {
  id: string;
  certificate_id: string;
  company_name: string;
  lat?: number;
  lon?: number;
  esg_score?: number;
  esg_grade?: string;
  compliance?: unknown;
  anomalies?: unknown[];
  data_sources?: unknown[];
  data_hash?: string;
  pdf_sha256?: string;
  pdf_blob_name?: string;
  pdf_blob_url?: string;
  canonical_payload?: Record<string, unknown>;
  canonicalization?: Record<string, unknown>;
  signature?: string;
  timestamp?: string;
  issued_at?: string;
  issued_by?: string;
  payload?: Record<string, unknown>;
};

export async function saveCertificate(record: CertificateRecord): Promise<boolean> {
  const c = await getCertificatesContainer();
  if (!c) return false;
  try {
    await c.items.upsert(record);
    return true;
  } catch (err) {
    logger.error({ err, id: record.id }, "Failed to save certificate to Cosmos");
    return false;
  }
}

export async function findCertificate(
  certificateId: string,
): Promise<CertificateRecord | null> {
  const c = await getCertificatesContainer();
  if (!c) return null;
  try {
    const { resources } = await c.items
      .query<CertificateRecord>({
        query: "SELECT * FROM c WHERE c.certificate_id = @id OR c.id = @id",
        parameters: [{ name: "@id", value: certificateId }],
      })
      .fetchAll();
    return resources[0] ?? null;
  } catch (err) {
    logger.error({ err, certificateId }, "Failed to query certificate");
    return null;
  }
}
