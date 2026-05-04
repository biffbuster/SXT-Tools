// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IQueryRouter
/// @author Placeholder
/// @notice Interface for querying external data sources with cryptographic proofs
interface IQueryRouter {
    /// @notice Query details
    /// @param version Query version identifier
    /// @param innerQuery Encoded, version-dependent query payload
    /// @param parameters Encoded parameters for the query
    /// @param metadata Encoded metadata for the query
    struct Query {
        bytes32 version;
        bytes innerQuery;
        bytes parameters;
        bytes metadata;
    }

    /// @notice Callback execution details
    /// @param maxGasPrice Max native gas price allowed for the callback
    /// @param gasLimit Gas limit forwarded to the callback contract
    /// @param callbackContract Address of the contract to call back
    /// @param selector Function selector to call on the callback contract
    /// @param callbackData Opaque callback-specific data passed to the callback
    struct Callback {
        uint256 maxGasPrice;
        uint64 gasLimit;
        address callbackContract;
        bytes4 selector;
        bytes callbackData;
    }

    /// @notice Payment info for queries
    /// @param paymentAmount Funds held when pending fulfillment
    /// @param refundTo Recipient of refunds or excess payment returns
    /// @param timeout Timestamp after which cancellation is allowed
    struct Payment {
        uint256 paymentAmount;
        address refundTo;
        uint64 timeout;
    }

    /// @notice Emitted when a query is requested
    /// @param queryId Unique identifier for the query
    /// @param queryNonce Nonce used when the query was created
    /// @param requester Address that requested the query
    /// @param query Query details
    /// @param callback Callback details
    /// @param payment Payment details
    event QueryRequested(
        bytes32 indexed queryId,
        uint64 indexed queryNonce,
        address indexed requester,
        Query query,
        Callback callback,
        Payment payment
    );

    /// @notice Emitted when a query has been fulfilled (logical fulfillment/result)
    /// @param queryId Unique identifier for the query
    /// @param fulfiller Address that fulfilled the query
    /// @param result The query result data
    event QueryFulfilled(bytes32 indexed queryId, address indexed fulfiller, bytes result);

    /// @notice Emitted when a payout for a fulfilled query occurred (payments/refunds)
    /// @param queryId Unique identifier for the query
    /// @param fulfiller Address that fulfilled the query
    /// @param refundRecipient Address that received a refund (if any)
    /// @param fulfillerAmount Amount paid to the fulfiller for this fulfillment
    /// @param refundAmount Amount refunded to the refundRecipient (if any)
    event PayoutOccurred(
        bytes32 indexed queryId,
        address indexed fulfiller,
        address indexed refundRecipient,
        uint256 fulfillerAmount,
        uint256 refundAmount
    ); // solhint-disable-line gas-indexed-events

    /// @notice Emitted when a query is cancelled
    /// @param queryId Unique identifier for the query
    /// @param refundRecipient Address that received the refund
    /// @param refundAmount Amount refunded
    event QueryCancelled(bytes32 indexed queryId, address indexed refundRecipient, uint256 indexed refundAmount);

    /// @notice Emitted when open fulfillment is toggled
    /// @param enabled Whether open fulfillment is now enabled
    event OpenFulfillmentToggled(bool indexed enabled);

    /// @notice Emitted when the base cost used by the router is updated
    /// @param newBaseCost The new base cost value
    event BaseCostUpdated(uint256 indexed newBaseCost);

    /// @notice Emitted when a version is set
    /// @param version The string version
    /// @param versionHash The keccak256 hash of the version
    /// @param verifier The verifier contract address associated with the version
    event VersionSet(string version, bytes32 indexed versionHash, address indexed verifier);

    /// @notice Thrown when a query is not found or unauthorized cancellation is attempted
    error QueryNotFound();

    /// @notice Thrown when a query cancellation is attempted before the timeout
    error QueryTimeoutNotReached();

    /// @notice Thrown when the query version is not supported by the router
    error UnsupportedQueryVersion();

    /// @notice Register a verifier contract address to a version string
    /// @param version The string version to hash
    /// @param verifier The contract address to associate with the version
    function registerVerifierToVersion(string calldata version, address verifier) external;

    /// @notice Set the base cost for queries
    /// @param newBaseCost The new base cost
    function setBaseCost(uint256 newBaseCost) external;

    /// @notice Cancel a pending query and refund the payment
    /// @param queryId Unique identifier for the query to cancel
    /// @param payment Payment struct for the original request.
    function cancelQuery(bytes32 queryId, Payment calldata payment) external;

    /// @notice Request a query to be executed.
    /// @param query Query struct containing query string, parameters, and version.
    /// @param callback Callback struct containing callback details.
    /// @param payment Payment struct containing payment details.
    /// @return queryId Unique ID for this query.
    function requestQuery(Query calldata query, Callback calldata callback, Payment calldata payment)
        external
        returns (bytes32 queryId);

    /// @notice Fulfill a query by providing its data and proof.
    /// @param query Query struct for the original request.
    /// @param callback Callback struct for the original request.
    /// @param payment Payment struct for the original request.
    /// @param queryNonce Nonce used when the query was created.
    /// @param proof Encoded proof containing the query result and cryptographic proof.
    function fulfillQuery(
        Query calldata query,
        Callback calldata callback,
        Payment calldata payment,
        uint64 queryNonce,
        bytes calldata proof
    ) external;

    /// @notice Toggle open fulfillment on or off
    /// @param enabled True to allow anyone to fulfill, false to restrict to FULFILLER_ROLE
    function setOpenFulfillment(bool enabled) external;

    /// @notice Verify a query result without executing its callback.
    /// @param query Query struct for the original request.
    /// @param proof Encoded proof containing the query result and cryptographic proof.
    /// @return result The query result data extracted from the proof.
    function verifyQuery(Query calldata query, bytes calldata proof) external view returns (bytes memory result);
}
