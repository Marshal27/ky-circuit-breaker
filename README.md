# ky-circuit-breaker
The premise here is that I wanted to have a circuit breaker pattern that could leverage the native API of a `KyInstance`. There are other options available for adopting a circuit breaker pattern, however, my goal was simplicity in the sense that I wanted to pass my `KyInstance` via the constructor and the library do the rest.

State machine logic was adopted from `albertllousas` work over @ https://github.com/albertllousas/circuit-breaker-typescript and the kudos go to him for the state machine.


If you find this work helpful please consider buying me a coffee.
<br/>
<a href="https://www.buymeacoffee.com/marshal27" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/default-orange.png" alt="Buy Me A Coffee" height="41" width="174"></a>
____________________________

# Getting Started

## Why to use it

If this resilience pattern does not sound familiar to you, take a look on these resources:
- [Circuit breaker wikipedia](https://en.wikipedia.org/wiki/Circuit_breaker_design_pattern)
- [Circuit breaker - Martin Fowler](https://martinfowler.com/bliki/CircuitBreaker.html)
- [Release It!](https://pragprog.com/book/mnee2/release-it-second-edition)

## Install

```bash
npm i ky-circuit-breaker
```

## How to Use It

The below approach will protect all of the following automagically.
  - ky.get
  - ky.post
  - ky.put
  - ky.patch
  - ky.head
  - ky.delete
```js
import ky from 'ky';
import { CircuitBreaker } from 'ky-circuit-breaker';

const circuitBreaker = new CircuitBreaker(ky);
// that's it, your native KyInstance functions 
// are now protected with a CircuitBreaker using the default settings.

const result = await ky.get('https://httpbin.org/get').json();
// make calls the normal way.
```

#### Promises
Let's assume you have an http call and you want to fail-fast gracefully without waiting for TCP connection timeout in
 case of the service eventually is not available...you can protect that individual promise with the example below:
```js

const unprotectedPromise = () => fetch(someUrl).then(response => response.json());
```

Protecting it is pretty straight forward:
```js

const circuitBreaker = new CircuitBreaker();

const protectedPromise = circuitBreaker.protectPromise(unprotectedPromise);

//normal use
protectedPromise().then(...);
```

# Exports

## CircuitStatusFlag

Enum for circuitStatus

shape: 

```js

export enum CircuitStatusFlag {
    CLOSED,
    HALF,
    OPEN
}
```

# Custom params

## CircuitBreaker(config: CircuitBreakerConfig)

Create a new instance of a circuit breaker. It accepts the following config options:

```json
    maxFailures: number;
    timeoutLimit: number;
    hooks?: {
        beforeRequest?: { (): void }[],
        afterPromiseComplete?: { (recoveryAttempts: number, recoverySuccessful: boolean, recoveryFailed: boolean): void }[]
    }
```

## CircuitBreakerConfig: `maxFailures`

Number of errors after the circuit trips to open and starts short-circuiting requests and failing-fast.

*Default Value:* 5

## CircuitBreakerConfig: `timeoutLimit`

Time in milliseconds in which after tripping to open the circuit will remain failing fast.

*Default Value:* 5000

## CircuitBreakerConfig: `hooks`

Hooks specific to the circuit breaker.

`beforeRequest` - **Synonymous to ky before request hook** - function callback before every request.
`afterPromiseComplete` - function callback after every promise is complete.

## Possible Usage:
```typescript

import { CircuitBreaker, CircuitStatusFlag } from 'ky-circuit-breaker';

private setHttpClient(): void {
    const circuitBreakerStateHandler = (recoveryAttempts?, recoveryFailed?) => {
      if (this.circuitBreaker.circuitStatus === CircuitStatusFlag.OPEN && recoveryAttempts === this.circuitRecoveryThreshold) {
       /* Shut down the app */
        return;
      } 

      switch (this.circuitBreaker.circuitStatus) {
        case CircuitStatusFlag.CLOSED: {
          /* Handle circuit breaker closure */
           if (recoverySuccessful) {
            /* Handle recovery successful */
           }
          break;
        }
        case CircuitStatusFlag.OPEN: {
          /* Handle circuit breaker opening */
          if (recoveryFailed) {
            /* Handle recovery failure */
          }
          break;
        }
        case CircuitStatusFlag.HALF: {
          /* Handle circuit breaker half open*/
          break;
        }
        default:
          break;
      }
    };

    this.httpClient = ky.extend({
      prefixUrl,
      timeout: false,
      retry: {
        limit: 5,
        methods: ['post', 'get', 'put']
      },
    });
    this.circuitBreaker = new CircuitBreaker(this.httpClient, {
      maxFailures: 5,
      timeoutLimit: 5000,
      hooks: {
        beforeRequest: [circuitBreakerStateHandler],
        afterPromiseComplete: [circuitBreakerStateHandler]
      }
    });
  }
}
```
