import {
    ApolloClient,
    HttpLink,
    InMemoryCache,
    split,
} from '@apollo/client';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { getMainDefinition } from '@apollo/client/utilities';
import * as SecureStore from 'expo-secure-store';
import { createClient } from 'graphql-ws';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'https://api.example.com/v1';
const HTTP_GRAPHQL =
    process.env.EXPO_PUBLIC_GRAPHQL_URL || API_URL.replace(/\/api$/, '') + '/graphql';
const WS_URL =
    process.env.EXPO_PUBLIC_GRAPHQL_WS_URL || API_URL.replace(/^http/, 'ws').replace(/\/api$/, '') + '/graphql';

// HTTP link for queries and mutations
const httpLink = new HttpLink({
    uri: HTTP_GRAPHQL,
    headers: {
        'Content-Type': 'application/json',
    },
    fetch: async (uri, options) => {
        const token = await SecureStore.getItemAsync('authToken');
        const headers = new Headers(options?.headers);
        if (token) {
            headers.set('Authorization', `Bearer ${token}`);
        }
        return fetch(uri, { ...options, headers });
    },
});

// WebSocket link for subscriptions (graphql-ws protocol)
const wsLink = new GraphQLWsLink(
    createClient({
        url: WS_URL,
        connectionParams: async () => {
            const token = await SecureStore.getItemAsync('authToken');
            return token ? { authorization: `Bearer ${token}` } : {};
        },
        lazy: true,
        retryAttempts: 5,
        shouldRetry: () => true,
        on: {
            connected: () => console.log('[GraphQL WS] Connected'),
            closed: (event) => console.log('[GraphQL WS] Closed', event?.code, event?.reason),
            error: (err) => console.warn('[GraphQL WS] Error', err?.message),
        },
    })
);

// Split: use WebSocket for subscriptions, HTTP for queries/mutations
const splitLink = split(
    ({ query }) => {
        const definition = getMainDefinition(query);
        return (
            definition.kind === 'OperationDefinition' &&
            definition.operation === 'subscription'
        );
    },
    wsLink,
    httpLink
);

export const apolloClient = new ApolloClient({
    link: splitLink,
    cache: new InMemoryCache(),
    defaultOptions: {
        watchQuery: {
            fetchPolicy: 'cache-and-network',
            errorPolicy: 'all',
        },
        query: {
            fetchPolicy: 'cache-first',
            errorPolicy: 'all',
        },
        mutate: {
            errorPolicy: 'all',
        },
    },
});

export const clearApolloCache = async () => {
    try {
        await apolloClient.clearStore();
    } catch (error) {
        console.warn('Error clearing Apollo cache:', error);
    }
};

export { WS_URL };
