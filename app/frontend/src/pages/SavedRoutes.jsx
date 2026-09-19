import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SgdsButton, SgdsCard, SgdsInput } from "@govtechsg/sgds-web-component/react";
import { api } from "../api.js";
import PageHeader from "../components/PageHeader.jsx";
import { deleteRoute, listRoutes, saveRoute } from "../services/savedRoutes.js";

const CARD_TITLE = "sgds:text-label-md sgds:font-semibold sgds:uppercase sgds:text-default";

function defaultDepartAt() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function SavedRoutes() {
  const navigate = useNavigate();
  const [routes, setRoutes] = useState(() => listRoutes());
  const [from, setFrom] = useState(null);
  const [to, setTo] = useState(null);
  const [departAt, setDepartAt] = useState(defaultDepartAt());

  function handleSave() {
    if (!from || !to) return;
    saveRoute({ from, to, departAt });
    setRoutes(listRoutes());
    setFrom(null);
    setTo(null);
  }

  function handleDelete(id) {
    deleteRoute(id);
    setRoutes(listRoutes());
  }

  // Tap-to-repopulate: hands the route to the planner as router state (see services/savedRoutes.js for
  // what JourneyPlanner needs to read it).
  function handleOpen(route) {
    navigate("/journey-planner", { state: { prefill: route } });
  }

  return (
    <>
      <PageHeader title="Saved Routes" onBack={() => navigate("/")} />
      <div className="sgds:flex sgds:flex-col sgds:gap-component-md sgds:p-layout-md">
        <SgdsCard>
          <span slot="title" className={CARD_TITLE}>Save a route</span>
          <div className="sgds:flex sgds:flex-col sgds:gap-component-md">
            <AddressField key={`from-${routes.length}`} label="From" onPick={setFrom} />
            <AddressField key={`to-${routes.length}`} label="To" onPick={setTo} />
            <SgdsInput type="datetime-local" label="Usual departure" value={departAt} onSgdsInput={(e) => setDepartAt(e.target.value)} />
            <SgdsButton fullWidth ariaLabel="Save route" disabled={!from || !to} onClick={handleSave}>
              Save route
            </SgdsButton>
          </div>
        </SgdsCard>

        {routes.length === 0 ? (
          <p className="sgds:px-layout-md sgds:py-layout-lg sgds:text-center sgds:text-body-sm sgds:text-subtle">
            No saved routes yet. Save the trips you make often and open them in the planner with one tap.
          </p>
        ) : (
          routes.map((r) => (
            <SgdsCard key={r.id}>
              <span slot="title" className="sgds:text-body-md sgds:font-semibold sgds:text-default">
                {r.from.label} → {r.to.label}
              </span>
              <p className="sgds:mb-component-sm sgds:text-caption-md sgds:text-subtle">
                {r.arrivalWindow
                  ? `Arrive by ${new Date(r.arrivalWindow).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                  : r.departAt
                    ? `Usually departs ${new Date(r.departAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}`
                    : "No time saved"}
              </p>
              <div className="sgds:flex sgds:gap-component-xs">
                <SgdsButton size="sm" ariaLabel="Plan this route" onClick={() => handleOpen(r)}>
                  Plan
                </SgdsButton>
                <SgdsButton size="sm" variant="outline" tone="danger" ariaLabel="Delete this route" onClick={() => handleDelete(r.id)}>
                  Delete
                </SgdsButton>
              </div>
            </SgdsCard>
          ))
        )}
      </div>
    </>
  );
}

// Address search field (OneMap via /api/geocode/search): debounced, min 3 characters.
function AddressField({ label, onPick }) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (picked && query === picked.label) return;
    if (query.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchAddress(query.trim());
        setSuggestions(data.results || []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(debounceRef.current);
  }, [query, picked]);

  function pick(r) {
    const point = { label: r.label, lat: r.lat, lng: r.lng };
    setQuery(r.label);
    setPicked(point);
    setOpen(false);
    onPick(point);
  }

  return (
    <div className="sgds:relative">
      <SgdsInput
        type="text"
        label={label}
        placeholder="Search an address, building, or postal code"
        autocomplete="off"
        loading={searching}
        value={query}
        onSgdsInput={(e) => {
          setQuery(e.target.value);
          if (picked) {
            setPicked(null);
            onPick(null);
          }
        }}
        onSgdsBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && suggestions.length > 0 && (
        <div className="sgds:absolute sgds:inset-x-0 sgds:top-full sgds:z-20 sgds:mt-1 sgds:max-h-64 sgds:overflow-y-auto sgds:rounded-md sgds:border sgds:border-default sgds:bg-surface-raised sgds:shadow-3">
          {suggestions.slice(0, 6).map((r, i) => (
            <div
              key={i}
              className="sgds:cursor-pointer sgds:border-b sgds:border-muted sgds:p-component-sm sgds:last:border-b-0 sgds:hover:bg-surface-default"
              onMouseDown={() => pick(r)}
            >
              <div className="sgds:text-body-sm sgds:text-default">{r.label}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
