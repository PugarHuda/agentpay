// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title AgentPay Agent Registry — a two-sided marketplace catalog
/// @notice Agents self-register an on-chain profile (name, bio, capabilities,
///         suggested rate). Clients browse the catalog and hire from it. Combined
///         with each agent's on-chain track record (TaskPaid / dispute events from
///         the escrow), this turns AgentPay into a real marketplace where proven
///         agents stand out. The registry is permissionless: any address can list
///         itself and update or deactivate its own profile.
contract AgentRegistry {
    struct Profile {
        string name;
        string bio;
        string capabilities; // comma-separated tags, e.g. "analytics,defi,reporting"
        uint256 suggestedRate; // wei per task (advisory)
        bool active;
        uint64 since; // first registration timestamp
    }

    mapping(address => Profile) public profiles;
    mapping(address => bool) public isRegistered;
    address[] private _agents;

    event AgentRegistered(address indexed agent, string name, uint256 suggestedRate);
    event AgentUpdated(address indexed agent, string name, uint256 suggestedRate, bool active);

    error EmptyName();

    /// @notice Register or fully update your own agent profile.
    function register(
        string calldata name,
        string calldata bio,
        string calldata capabilities,
        uint256 suggestedRate
    ) external {
        if (bytes(name).length == 0) revert EmptyName();
        Profile storage p = profiles[msg.sender];
        if (!isRegistered[msg.sender]) {
            isRegistered[msg.sender] = true;
            p.since = uint64(block.timestamp);
            _agents.push(msg.sender);
            emit AgentRegistered(msg.sender, name, suggestedRate);
        }
        p.name = name;
        p.bio = bio;
        p.capabilities = capabilities;
        p.suggestedRate = suggestedRate;
        p.active = true;
        emit AgentUpdated(msg.sender, name, suggestedRate, true);
    }

    /// @notice Toggle your listing on/off without losing your profile.
    function setActive(bool active) external {
        require(isRegistered[msg.sender], "not registered");
        profiles[msg.sender].active = active;
        Profile storage p = profiles[msg.sender];
        emit AgentUpdated(msg.sender, p.name, p.suggestedRate, active);
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function getAgent(address agent)
        external
        view
        returns (address addr, Profile memory profile)
    {
        return (agent, profiles[agent]);
    }

    /// @notice Paginated catalog read for the marketplace UI.
    function getAgents(uint256 offset, uint256 limit)
        external
        view
        returns (address[] memory addrs, Profile[] memory page)
    {
        uint256 len = _agents.length;
        if (offset >= len) return (new address[](0), new Profile[](0));
        uint256 end = offset + limit > len ? len : offset + limit;
        uint256 n = end - offset;
        addrs = new address[](n);
        page = new Profile[](n);
        for (uint256 i = 0; i < n; i++) {
            addrs[i] = _agents[offset + i];
            page[i] = profiles[_agents[offset + i]];
        }
    }
}
