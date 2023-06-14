import 'isomorphic-fetch';
import { CircuitBreaker, CircuitBreakerConfig } from '../circuit-breaker';
import { KyResponse, Options } from 'ky';
import { Input } from 'ky/distribution/types/options';

describe('Circuit breaker', () => {
    const promiseResolve = new Promise(resolve => resolve(''));
    const promiseReject = new Promise((resolve, reject) => reject(''));
    const mockPromiseResolve = (input: Input, options: Options | undefined) => promiseResolve as any;
    const mockPromiseReject = (input: Input, options: Options | undefined) => promiseReject as any;
    const wait = (millis: number) => new Promise(resolve => setTimeout(resolve, millis));
    let mockOptions: any = {};
    let resolvePromise = true;
    const mockKyInstance: any = {
        get: function(input: any, options: any) {
            mockOptions = options;
            return resolvePromise ? Promise.resolve() : Promise.reject('I AM NOW DEFINED')
        },
    };
    const mockCircuitBreaker = {
        handleStateTransition: (flag: any) => {}
    }
    const mockCircuitBreakerConfig: CircuitBreakerConfig = {
        maxFailures: 1, 
        timeoutLimit: 10,
        hooks: {
            beforeRequest: [() => {}],
            afterPromiseComplete: [() => {}]
        } 
    }

    let circuitBreaker: CircuitBreaker;
    let protectPromiseSpy: any;
    let handleStateTransitionSpy: any;

    protectPromiseSpy = jest.spyOn(CircuitBreaker.prototype, 'protectPromise');
    circuitBreaker = new CircuitBreaker(mockKyInstance as any, mockCircuitBreakerConfig);
    
    handleStateTransitionSpy = jest.spyOn(mockCircuitBreaker, 'handleStateTransition');

    circuitBreaker['handleStateTransition'] = mockCircuitBreaker.handleStateTransition;

    afterEach(() => {
        jest.clearAllMocks();
      });

    describe('protecting a promise', () => {
        it('should protect all default ky functions', () => {
            expect(protectPromiseSpy).toHaveBeenCalledTimes(6);
        });
        it('should assign ky hooks to options and callSucceed', async () => {
            await mockKyInstance.get({}, {});

            expect(mockOptions.hooks.beforeRetry.length).toBeTruthy();
            expect(mockOptions.hooks.beforeRequest.length).toBeTruthy();
        });
        it('should assign signal', async () => {
            await mockKyInstance.get({}, {});

            expect(mockOptions.signal).toBeTruthy();
        });
        it('should return instance of Promise<KyResponse>', async () => {
            const result = circuitBreaker.protectPromise(mockPromiseResolve)('test');

            expect(result).toBeInstanceOf(Promise<KyResponse>);
        });
        it('should call handleStateTransition on promise resolve', async () => {
            await circuitBreaker.protectPromise(mockPromiseResolve)('test');
    
            expect(handleStateTransitionSpy).toBeCalledTimes(1);
            expect(handleStateTransitionSpy).toBeCalledWith('CallSucceed')
        });
        it('should call handleStateTransition on promise reject', async () => {
            await circuitBreaker.protectPromise(mockPromiseReject)('test').catch(() => {});
    
            expect(handleStateTransitionSpy).toBeCalledTimes(1);
            expect(handleStateTransitionSpy).toBeCalledWith('CallFailed')
        });
        describe('beforeRetry', () => {
            it('should call handleStateTransition', () => {
                mockOptions.hooks.beforeRetry[0]();

                expect(handleStateTransitionSpy).toBeCalledTimes(1);
                expect(handleStateTransitionSpy).toBeCalledWith('CallFailed');
            });
        });
        describe('beforeRequest', () => {
            it('should call handleStateTransition', () => {    
                mockOptions.hooks.beforeRequest[0]();
    
                expect(handleStateTransitionSpy).toBeCalledTimes(1);
                expect(handleStateTransitionSpy).toBeCalledWith('BeforeCallSignal');
            });
            it('should abort when !this.stateMachine.currentState.isCallPermitted()', () => {
                circuitBreaker['stateMachine'] = {
                    currentState: {
                        isCallPermitted: () => false
                    }
                } as any;
                const spy = jest.spyOn(AbortController.prototype, 'abort');
    
                mockOptions.hooks.beforeRequest[0]();

                expect(spy).toBeCalledTimes(1);
            });
        });
    });
});