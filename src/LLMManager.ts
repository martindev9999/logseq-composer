
export async function queryLiteLLM(
  query: string,
  model: string,
  apiKey: string,
  endpoint: string
): Promise<any> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model, // Use the model from settings
      messages: [{ role: 'user', content: query }],
      api_key: apiKey,
    }),
  });

  let body: any = null;
  let rawBody: string | null = null;
  try {
    body = await response.json();
  } catch {
    try {
      rawBody = await (response as any).text?.();
    } catch {
      rawBody = null;
    }
  }

  if (!response.ok) {
    const errMsg =
      body?.error?.message ||
      body?.message ||
      rawBody ||
      `${response.status} ${response.statusText}`;
    throw new Error(`LiteLLM request failed: ${errMsg}`);
  }

  return body ?? {};
}
