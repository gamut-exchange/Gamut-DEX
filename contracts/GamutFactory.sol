// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./interfaces/IProtocolFeesCollector.sol";
import "./Pool.sol";
import "./lib/openzeppelin/Ownable.sol";

contract GamutFactory is Ownable {
    IProtocolFeesCollector private _protocolFeesCollector;

    address private immutable ROUTER;

    // To get the address of the nth pair (0-indexed) created through the factory,
    // or address(0) if not enough pairs have been created yet.
    // Pass 0 for the address of the first pair created, 1 for the second, etc.
    address[] public allPools;

    mapping(address => mapping(address => address)) public getPool;

    event ProtocolFeeCollectorSet(address protocolFeeCollectorAddress);

    event PoolCreated(
        address indexed token0,
        address indexed token1,
        address indexed pool
    );

    constructor(address routerAddress) {
        ROUTER = routerAddress;
    }

    function getRouter() public view returns (address) {
        return ROUTER;
    }

    /**
     * @dev Sets the protocol fee collector.
     */

    function setProtocolFeeCollector(address _newProtocolFeeCollector)
        external
        onlyOwner
    {
        _require(_newProtocolFeeCollector != address(0), Errors.ZERO_TOKEN);
        _protocolFeesCollector = IProtocolFeesCollector(
            _newProtocolFeeCollector
        );
        emit ProtocolFeeCollectorSet(_newProtocolFeeCollector);
    }

    /**
     * @dev Returns the protocol swap fee collector address.
     */
    function getProtocolFeesCollector() public view returns (address) {
        return address(_protocolFeesCollector);
    }

    /**
     * @dev Returns the protocol swap fee percentage.
     */
    function _getProtocolSwapFeePercentage() external view returns (uint256) {
        return
            address(_protocolFeesCollector) != address(0)
                ? _protocolFeesCollector.getProtocolSwapFeePercentage()
                : 0;
    }

    /**
     * @dev Returns the total number of pairs created through the factory so far.
     */
    function allPoolsLength() external view returns (uint256) {
        return allPools.length;
    }

    /**
     * @dev Deploys a new Pool.
     *
     * Note '_changeSwapFee' true indicates that swap can be changed by the pool owner after Pool is created.
     */
    function create(
        address tokenA,
        address tokenB,
        uint256 weightA,
        uint256 weightB,
        uint256 _swapFeePercentage,
        bool _changeSwapFee
    ) external returns (address) {
        _require(tokenA != tokenB, Errors.IDENTICAL_ADDRESSES);
        // Sorting tokens in ascending order
        (
            address _token0,
            address _token1,
            uint256 _weight0,
            uint256 _weight1
        ) = tokenA < tokenB
                ? (tokenA, tokenB, weightA, weightB)
                : (tokenB, tokenA, weightB, weightA);

        _require(_token0 != address(0), Errors.ZERO_TOKEN);
        _require(getPool[_token0][_token1] == address(0), Errors.POOL_EXISTS);

        Pool.NewPoolParams memory params = Pool.NewPoolParams({
            router: getRouter(),
            token0: IERC20(_token0),
            token1: IERC20(_token1),
            weight0: _weight0,
            weight1: _weight1,
            swapFeePercentage: _swapFeePercentage,
            changeSwapFeeEnabled: _changeSwapFee,
            owner: msg.sender
        });

        address pool = address(new Pool(params));
        getPool[_token0][_token1] = pool;
        getPool[_token1][_token0] = pool; // populate mapping in the reverse direction
        allPools.push(pool);
        emit PoolCreated(_token0, _token1, pool);
        return pool;
    }
}
