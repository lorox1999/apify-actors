export class FatalInputError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FatalInputError';
    }
}
