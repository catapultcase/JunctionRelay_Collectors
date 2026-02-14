import { getDecimalPlaces } from '@junctionrelay/collector-sdk'
import type { CollectorPluginConfig, SensorResult, ConfigureParams } from '@junctionrelay/collector-sdk'

const BASE_URL = 'https://api.anthropic.com'
const REQUEST_TIMEOUT_MS = 10000
const API_VERSION = '2023-06-01'

async function apiGet(path: string, adminKey: string): Promise<unknown> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      headers: {
        'x-api-key': adminKey,
        'anthropic-version': API_VERSION,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    })

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`)
    }

    return await resp.json()
  } finally {
    clearTimeout(timeout)
  }
}

function getTodayRange(): { startingAt: string; endingAt: string } {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = String(now.getUTCMonth() + 1).padStart(2, '0')
  const day = String(now.getUTCDate()).padStart(2, '0')
  const startingAt = `${year}-${month}-${day}T00:00:00Z`
  const endingAt = now.toISOString()
  return { startingAt, endingAt }
}

interface OrgResponse {
  id?: string
  name?: string
}

interface WorkspacesResponse {
  data?: unknown[]
}

interface ApiKeysResponse {
  data?: Array<{ status?: string }>
}

interface UsageBucket {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

interface UsageResponse {
  data?: UsageBucket[]
}

interface CostBucket {
  total_cost_usd?: number
  token_cost_usd?: number
}

interface CostResponse {
  data?: CostBucket[]
}

export default {
  metadata: {
    collectorName: 'junctionrelay.claude',
    displayName: 'Claude (Anthropic)',
    description: 'API usage, costs, and organization monitoring',
    category: 'Cloud Services',
    emoji: '\u{1F916}',
    fields: {
      requiresUrl: false,
      requiresAccessToken: true,
      accessTokenLabel: 'Admin API Key',
      accessTokenPlaceholder: 'sk-ant-admin...',
    },
    defaults: {
      name: 'Claude',
      pollRate: 60000,
      sendRate: 60000,
    },
    setupInstructions: [
      {
        title: 'Get an Admin API Key',
        body: 'Go to console.anthropic.com \u2192 Settings \u2192 Admin API keys \u2192 Create key',
      },
      {
        title: 'Required Permissions',
        body: 'Key needs org:read and usage:read permissions',
      },
      {
        title: 'Usage Data Delay',
        body: 'Usage and cost data may be delayed up to 5 minutes from Anthropic',
      },
    ],
  },

  async configure() {
    return { success: true }
  },

  async testConnection(config: ConfigureParams) {
    const adminKey = config.accessToken ?? ''
    if (!adminKey) {
      return { success: false, error: 'Admin API key is required' }
    }

    try {
      await apiGet('/v1/organizations/me', adminKey)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  },

  async fetchSensors(config: ConfigureParams) {
    const adminKey = config.accessToken ?? ''
    if (!adminKey) throw new Error('Not configured \u2014 Admin API key is required')

    const sensors: SensorResult[] = []
    const { startingAt, endingAt } = getTodayRange()

    // Fetch all endpoints in parallel, catching individual failures
    const [orgResult, workspacesResult, apiKeysResult, usageResult, costResult] = await Promise.allSettled([
      apiGet('/v1/organizations/me', adminKey) as Promise<OrgResponse>,
      apiGet('/v1/organizations/workspaces', adminKey) as Promise<WorkspacesResponse>,
      apiGet('/v1/organizations/api_keys', adminKey) as Promise<ApiKeysResponse>,
      apiGet(`/v1/organizations/usage_report/messages?starting_at=${startingAt}&ending_at=${endingAt}&bucket_width=1d`, adminKey) as Promise<UsageResponse>,
      apiGet(`/v1/organizations/cost_report?starting_at=${startingAt}&ending_at=${endingAt}&bucket_width=1d`, adminKey) as Promise<CostResponse>,
    ])

    // Organization sensors
    if (orgResult.status === 'fulfilled') {
      const org = orgResult.value
      sensors.push({
        uniqueSensorKey: 'org_name',
        name: 'Organization Name',
        value: org.name ?? 'Unknown',
        unit: 'N/A',
        category: 'Organization',
        decimalPlaces: 0,
        sensorType: 'Text',
        componentName: 'Organization',
        sensorTag: 'Organization Name',
      })
    }

    if (workspacesResult.status === 'fulfilled') {
      const workspaces = workspacesResult.value
      const count = String(workspaces.data?.length ?? 0)
      sensors.push({
        uniqueSensorKey: 'org_workspace_count',
        name: 'Workspace Count',
        value: count,
        unit: 'count',
        category: 'Organization',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Organization',
        sensorTag: 'Workspace Count',
      })
    }

    if (apiKeysResult.status === 'fulfilled') {
      const apiKeys = apiKeysResult.value
      const activeCount = String(apiKeys.data?.filter(k => k.status === 'active').length ?? 0)
      sensors.push({
        uniqueSensorKey: 'org_active_api_keys',
        name: 'Active API Keys',
        value: activeCount,
        unit: 'count',
        category: 'Organization',
        decimalPlaces: 0,
        sensorType: 'Numeric',
        componentName: 'Organization',
        sensorTag: 'Active API Keys',
      })
    }

    // Usage sensors — sum all buckets for today
    if (usageResult.status === 'fulfilled') {
      const usage = usageResult.value
      let inputTokens = 0
      let outputTokens = 0
      let cacheReadTokens = 0
      let cacheCreationTokens = 0

      for (const bucket of usage.data ?? []) {
        inputTokens += bucket.input_tokens ?? 0
        outputTokens += bucket.output_tokens ?? 0
        cacheReadTokens += bucket.cache_read_input_tokens ?? 0
        cacheCreationTokens += bucket.cache_creation_input_tokens ?? 0
      }

      sensors.push(
        {
          uniqueSensorKey: 'usage_input_tokens_today',
          name: 'Input Tokens (Today)',
          value: String(inputTokens),
          unit: 'tokens',
          category: 'Usage',
          decimalPlaces: 0,
          sensorType: 'Numeric',
          componentName: 'Usage',
          sensorTag: 'Input Tokens',
        },
        {
          uniqueSensorKey: 'usage_output_tokens_today',
          name: 'Output Tokens (Today)',
          value: String(outputTokens),
          unit: 'tokens',
          category: 'Usage',
          decimalPlaces: 0,
          sensorType: 'Numeric',
          componentName: 'Usage',
          sensorTag: 'Output Tokens',
        },
        {
          uniqueSensorKey: 'usage_cache_read_tokens_today',
          name: 'Cache Read Tokens (Today)',
          value: String(cacheReadTokens),
          unit: 'tokens',
          category: 'Usage',
          decimalPlaces: 0,
          sensorType: 'Numeric',
          componentName: 'Usage',
          sensorTag: 'Cache Read Tokens',
        },
        {
          uniqueSensorKey: 'usage_cache_creation_tokens_today',
          name: 'Cache Creation Tokens (Today)',
          value: String(cacheCreationTokens),
          unit: 'tokens',
          category: 'Usage',
          decimalPlaces: 0,
          sensorType: 'Numeric',
          componentName: 'Usage',
          sensorTag: 'Cache Creation Tokens',
        },
      )
    }

    // Cost sensors — sum all buckets for today
    if (costResult.status === 'fulfilled') {
      const cost = costResult.value
      let totalCost = 0
      let tokenCost = 0

      for (const bucket of cost.data ?? []) {
        totalCost += bucket.total_cost_usd ?? 0
        tokenCost += bucket.token_cost_usd ?? 0
      }

      const totalStr = totalCost.toFixed(4)
      const tokenStr = tokenCost.toFixed(4)

      sensors.push(
        {
          uniqueSensorKey: 'cost_total_today',
          name: 'Total Cost (Today)',
          value: totalStr,
          unit: 'USD',
          category: 'Cost',
          decimalPlaces: getDecimalPlaces(totalStr),
          sensorType: 'Numeric',
          componentName: 'Cost',
          sensorTag: 'Total Cost',
        },
        {
          uniqueSensorKey: 'cost_tokens_today',
          name: 'Token Cost (Today)',
          value: tokenStr,
          unit: 'USD',
          category: 'Cost',
          decimalPlaces: getDecimalPlaces(tokenStr),
          sensorType: 'Numeric',
          componentName: 'Cost',
          sensorTag: 'Token Cost',
        },
      )
    }

    return { sensors }
  },
} satisfies CollectorPluginConfig
