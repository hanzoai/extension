// The Hanzo AI assistant panel — a Polaris React component. All the logic-heavy
// work (action catalogs, prompt assembly, request shaping, HMAC) lives in its
// own tested modules on the server + in api.ts; this component binds them to
// Polaris UI. It talks ONLY to the backend proxy (createApi) — it never holds a
// secret and never calls Shopify or api.hanzo.ai directly.
//
// Two tabs: Products (read a product, run a content action, preview, write back)
// and Orders (read an order, run a support action, copy). The action catalogs
// are the server's, mirrored here for labels so the buttons never drift from
// what the server will run.

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  BlockStack,
  Box,
  Button,
  ButtonGroup,
  Card,
  InlineStack,
  Select,
  Tabs,
  Text,
  TextField,
  Banner,
} from '@shopify/polaris';
import type { Api, Product, Order } from './api';
import type { LaunchContext } from './context';
import { toGid } from './context';

// The action buttons the panel shows. Ids MUST match the server's PRODUCT_ACTIONS
// / ORDER_ACTIONS keys — the server validates the id, so a mismatch is a clean
// 400, but we keep them in sync so the UI is honest.
const PRODUCT_ACTIONS = [
  { id: 'writeDescription', label: 'Write description', target: 'descriptionHtml' as const },
  { id: 'rewriteDescription', label: 'Rewrite description', target: 'descriptionHtml' as const },
  { id: 'seoTitle', label: 'SEO title', target: 'seoTitle' as const },
  { id: 'seoDescription', label: 'SEO meta description', target: 'seoDescription' as const },
];
const ORDER_ACTIONS = [
  { id: 'summarize', label: 'Summarize order' },
  { id: 'draftReply', label: 'Draft customer reply' },
  { id: 'extractIssues', label: 'Extract issues' },
];

export interface AssistantProps {
  api: Api;
  ctx: LaunchContext;
}

export function Assistant({ api, ctx }: AssistantProps): JSX.Element {
  const [tab, setTab] = useState(ctx.resource === 'order' ? 1 : 0);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState('');

  useEffect(() => {
    api
      .listModels()
      .then((ids) => {
        setModels(ids);
        if (ids.length) setModel((m) => m || ids[0]);
      })
      .catch(() => setModels([]));
  }, [api]);

  const modelSelect =
    models.length > 0 ? (
      <Select
        label="Model"
        labelInline
        options={models.map((id) => ({ label: id, value: id }))}
        value={model}
        onChange={setModel}
      />
    ) : null;

  const tabs = [
    { id: 'products', content: 'Products' },
    { id: 'orders', content: 'Orders' },
  ];

  return (
    <BlockStack gap="400">
      <Tabs tabs={tabs} selected={tab} onSelect={setTab} />
      <Box paddingInlineStart="400" paddingInlineEnd="400" paddingBlockEnd="400">
        {tab === 0 ? (
          <ProductPanel api={api} model={model} modelSelect={modelSelect} initialId={ctx.resource === 'product' ? ctx.resourceId : ''} />
        ) : (
          <OrderPanel api={api} model={model} modelSelect={modelSelect} initialId={ctx.resource === 'order' ? ctx.resourceId : ''} />
        )}
      </Box>
    </BlockStack>
  );
}

// ---- Product panel --------------------------------------------------------

function ProductPanel(props: { api: Api; model: string; modelSelect: JSX.Element | null; initialId: string }): JSX.Element {
  const { api, model, modelSelect, initialId } = props;
  const [idInput, setIdInput] = useState(initialId);
  const [product, setProduct] = useState<Product | null>(null);
  const [output, setOutput] = useState('');
  const [target, setTarget] = useState<'descriptionHtml' | 'seoTitle' | 'seoDescription'>('descriptionHtml');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'critical' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    const gid = toGid('Product', idInput);
    if (!gid) return;
    setBusy(true);
    setStatus(null);
    try {
      setProduct(await api.getProduct(gid));
      setOutput('');
    } catch (e: any) {
      setStatus({ tone: 'critical', text: e?.message || 'Failed to load product' });
      setProduct(null);
    } finally {
      setBusy(false);
    }
  }, [api, idInput]);

  useEffect(() => {
    if (initialId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  const run = useCallback(
    async (actionId: string, writeTarget: 'descriptionHtml' | 'seoTitle' | 'seoDescription') => {
      if (!product) return;
      setBusy(true);
      setStatus(null);
      setTarget(writeTarget);
      try {
        setOutput(await api.runProductAction(product.id, actionId, model));
      } catch (e: any) {
        setStatus({ tone: 'critical', text: e?.message || 'Generation failed' });
      } finally {
        setBusy(false);
      }
    },
    [api, product, model],
  );

  const writeBack = useCallback(async () => {
    if (!product || !output) return;
    setBusy(true);
    setStatus(null);
    try {
      const w =
        target === 'descriptionHtml'
          ? { descriptionHtml: output }
          : target === 'seoTitle'
            ? { seoTitle: output.trim() }
            : { seoDescription: output.trim() };
      await api.updateProduct(product.id, w);
      setStatus({ tone: 'success', text: `Saved to ${target === 'descriptionHtml' ? 'description' : target === 'seoTitle' ? 'SEO title' : 'SEO meta description'}.` });
    } catch (e: any) {
      setStatus({ tone: 'critical', text: e?.message || 'Save failed' });
    } finally {
      setBusy(false);
    }
  }, [api, product, output, target]);

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" align="start" blockAlign="end">
            <Box width="70%">
              <TextField
                label="Product ID or GID"
                value={idInput}
                onChange={setIdInput}
                autoComplete="off"
                placeholder="gid://shopify/Product/123 or 123"
              />
            </Box>
            <Button onClick={() => void load()} loading={busy} variant="primary">
              Load
            </Button>
          </InlineStack>
          {product && (
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="headingSm">{product.title}</Text>
              {product.status && <Badge>{product.status}</Badge>}
            </InlineStack>
          )}
        </BlockStack>
      </Card>

      {product && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Generate content</Text>
              {modelSelect}
            </InlineStack>
            <ButtonGroup>
              {PRODUCT_ACTIONS.map((a) => (
                <Button key={a.id} onClick={() => void run(a.id, a.target)} disabled={busy}>
                  {a.label}
                </Button>
              ))}
            </ButtonGroup>
          </BlockStack>
        </Card>
      )}

      {status && <Banner tone={status.tone}>{status.text}</Banner>}

      {output && (
        <Card>
          <BlockStack gap="300">
            <TextField label="Generated content" value={output} onChange={setOutput} multiline={6} autoComplete="off" />
            <InlineStack gap="200">
              <Button onClick={() => void writeBack()} variant="primary" loading={busy}>
                Save to product
              </Button>
            </InlineStack>
          </BlockStack>
        </Card>
      )}
    </BlockStack>
  );
}

// ---- Order panel ----------------------------------------------------------

function OrderPanel(props: { api: Api; model: string; modelSelect: JSX.Element | null; initialId: string }): JSX.Element {
  const { api, model, modelSelect, initialId } = props;
  const [idInput, setIdInput] = useState(initialId);
  const [order, setOrder] = useState<Order | null>(null);
  const [output, setOutput] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'success' | 'critical' | 'info'; text: string } | null>(null);

  const load = useCallback(async () => {
    const gid = toGid('Order', idInput);
    if (!gid) return;
    setBusy(true);
    setStatus(null);
    try {
      setOrder(await api.getOrder(gid));
      setOutput('');
    } catch (e: any) {
      setStatus({ tone: 'critical', text: e?.message || 'Failed to load order' });
      setOrder(null);
    } finally {
      setBusy(false);
    }
  }, [api, idInput]);

  useEffect(() => {
    if (initialId) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialId]);

  const run = useCallback(
    async (actionId: string) => {
      if (!order) return;
      setBusy(true);
      setStatus(null);
      try {
        setOutput(await api.runOrderAction(order.id, actionId, model));
      } catch (e: any) {
        setStatus({ tone: 'critical', text: e?.message || 'Generation failed' });
      } finally {
        setBusy(false);
      }
    },
    [api, order, model],
  );

  return (
    <BlockStack gap="400">
      <Card>
        <BlockStack gap="300">
          <InlineStack gap="200" align="start" blockAlign="end">
            <Box width="70%">
              <TextField
                label="Order ID or GID"
                value={idInput}
                onChange={setIdInput}
                autoComplete="off"
                placeholder="gid://shopify/Order/123 or 123"
              />
            </Box>
            <Button onClick={() => void load()} loading={busy} variant="primary">
              Load
            </Button>
          </InlineStack>
          {order && (
            <InlineStack gap="200" blockAlign="center">
              <Text as="span" variant="headingSm">{order.name}</Text>
              {order.financialStatus && <Badge>{order.financialStatus}</Badge>}
              {order.fulfillmentStatus && <Badge>{order.fulfillmentStatus}</Badge>}
            </InlineStack>
          )}
        </BlockStack>
      </Card>

      {order && (
        <Card>
          <BlockStack gap="300">
            <InlineStack align="space-between" blockAlign="center">
              <Text as="h3" variant="headingSm">Order actions</Text>
              {modelSelect}
            </InlineStack>
            <ButtonGroup>
              {ORDER_ACTIONS.map((a) => (
                <Button key={a.id} onClick={() => void run(a.id)} disabled={busy}>
                  {a.label}
                </Button>
              ))}
            </ButtonGroup>
          </BlockStack>
        </Card>
      )}

      {status && <Banner tone={status.tone}>{status.text}</Banner>}

      {output && (
        <Card>
          <TextField label="Result" value={output} onChange={setOutput} multiline={8} autoComplete="off" />
        </Card>
      )}
    </BlockStack>
  );
}
