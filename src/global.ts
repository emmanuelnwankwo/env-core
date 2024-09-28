declare namespace NodeJS {
    
    interface ProcessEnv {
        [key: string]: string | undefined;
    }

    interface Process {
        env: ProcessEnv;
        exit(code?: number): never;
    }

    const process: Process;
}
