declare module 'axios' {
    export interface AxiosResponse<T = any> {
        data: T;
        status: number;
        statusText: string;
        headers: any;
        config: any;
        request?: any;
    }

    export interface AxiosError<T = any> extends Error {
        config: any;
        code?: string;
        request?: any;
        response?: AxiosResponse<T>;
        isAxiosError: boolean;
        toJSON: () => object;
    }

    export function isAxiosError(payload: any): payload is AxiosError;

    const axios: {
        post: <T = any>(url: string, data?: any, config?: any) => Promise<AxiosResponse<T>>;
        get: <T = any>(url: string, config?: any) => Promise<AxiosResponse<T>>;
        put: <T = any>(url: string, data?: any, config?: any) => Promise<AxiosResponse<T>>;
        delete: <T = any>(url: string, config?: any) => Promise<AxiosResponse<T>>;
        request: <T = any>(config: any) => Promise<AxiosResponse<T>>;
        isAxiosError: typeof isAxiosError;
    };

    export default axios;
}